//! Session parsers. Each one is tolerant: unknown records are skipped or
//! shown as raw JSON, malformed lines never abort parsing.

use crate::model::{first_line, truncate, Msg, Parsed};
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::Path;

const TOOL_MAX: usize = 20_000;

pub fn parse_file(kind: &str, path: &Path) -> Result<Parsed, String> {
    let p = match kind {
        "claude" => claude(jsonl(path)?),
        "codex" => codex(jsonl(path)?),
        "gemini" => {
            let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
            match serde_json::from_str::<Value>(&text) {
                Ok(v) => {
                    let mut p = gemini(&v);
                    // tmp/<project>/chats/session-*.json -> tmp/<project>/.project_root
                    if p.meta.cwd.is_none() {
                        let root = path.parent().and_then(Path::parent).map(|d| d.join(".project_root"));
                        p.meta.cwd = root.and_then(|r| std::fs::read_to_string(r).ok()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
                    }
                    p
                }
                Err(_) => raw_text(&text),
            }
        }
        _ => {
            let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
            raw_text(&text)
        }
    };
    Ok(p.finish())
}

fn jsonl(path: &Path) -> Result<Vec<Value>, String> {
    let f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut out = vec![];
    for line in BufReader::new(f).lines() {
        let Ok(line) = line else { continue };
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Value>(&line) {
            Ok(v) => out.push(v),
            Err(_) => out.push(Value::String(line)),
        }
    }
    Ok(out)
}

fn raw_text(text: &str) -> Parsed {
    let mut p = Parsed::default();
    p.msgs.push(Msg::new("system", "raw", truncate(text, 200_000)));
    p
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::to_string)
}

fn pretty(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        _ => serde_json::to_string_pretty(v).unwrap_or_default(),
    }
}

/// Flatten tool output that may be a string or a list of {type,text} blocks.
fn flatten(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(items) => items
            .iter()
            .map(|i| match i.get("text").and_then(Value::as_str) {
                Some(t) => t.to_string(),
                None if i.get("type").and_then(Value::as_str) == Some("image") => "[图片]".to_string(),
                None => pretty(i),
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Null => String::new(),
        other => pretty(other),
    }
}

fn is_injected(text: &str) -> bool {
    let t = text.trim_start();
    t.starts_with('<') || t.starts_with("# AGENTS.md") || t.starts_with("Caveat:")
}

// ---------------- Claude Code ----------------

pub fn claude(lines: Vec<Value>) -> Parsed {
    let mut p = Parsed::default();
    for v in lines {
        let ts = s(&v, "timestamp");
        let t = v.get("type").and_then(Value::as_str).unwrap_or("");
        match t {
            "ai-title" => p.meta.title = s(&v, "aiTitle").or(p.meta.title.take()),
            "summary"
                if p.meta.title.is_none() => {
                    p.meta.title = s(&v, "summary");
                }
            "user" | "assistant" => {
                p.touch(ts.as_deref());
                if p.meta.session_id.is_none() {
                    p.meta.session_id = s(&v, "sessionId");
                }
                if p.meta.cwd.is_none() {
                    p.meta.cwd = s(&v, "cwd");
                }
                let Some(msg) = v.get("message") else { continue };
                if t == "assistant" {
                    if let Some(m) = s(msg, "model").filter(|m| !m.starts_with('<')) {
                        p.meta.model = Some(m);
                    }
                }
                let meta = v.get("isMeta").and_then(Value::as_bool).unwrap_or(false);
                claude_content(&mut p, t, msg.get("content").unwrap_or(&Value::Null), meta, ts);
            }
            _ => {}
        }
    }
    p
}

fn claude_content(p: &mut Parsed, role: &str, content: &Value, meta: bool, ts: Option<String>) {
    let push_text = |p: &mut Parsed, text: &str| {
        if text.trim().is_empty() {
            return;
        }
        let kind = if meta || (role == "user" && is_injected(text)) { "meta" } else { "text" };
        p.msgs.push(Msg::new(role, kind, text).at(ts.clone()));
    };
    match content {
        Value::String(text) => push_text(p, text),
        Value::Array(blocks) => {
            for b in blocks {
                match b.get("type").and_then(Value::as_str).unwrap_or("") {
                    "text" => push_text(p, b.get("text").and_then(Value::as_str).unwrap_or("")),
                    "thinking" => {
                        let t = b.get("thinking").and_then(Value::as_str).unwrap_or("");
                        if !t.trim().is_empty() {
                            p.msgs.push(Msg::new("assistant", "thinking", t).at(ts.clone()));
                        }
                    }
                    "tool_use" => p.msgs.push(
                        Msg::new("assistant", "tool_call", truncate(&pretty(b.get("input").unwrap_or(&Value::Null)), TOOL_MAX))
                            .named(s(b, "name"))
                            .at(ts.clone()),
                    ),
                    "tool_result" => p.msgs.push(
                        Msg::new("tool", "tool_result", truncate(&flatten(b.get("content").unwrap_or(&Value::Null)), TOOL_MAX))
                            .at(ts.clone()),
                    ),
                    "image" => p.msgs.push(Msg::new(role, "meta", "[图片]").at(ts.clone())),
                    "redacted_thinking" => {}
                    _ => p.msgs.push(Msg::new(role, "raw", truncate(&pretty(b), TOOL_MAX)).at(ts.clone())),
                }
            }
        }
        _ => {}
    }
}

// ---------------- Codex ----------------

pub fn codex(lines: Vec<Value>) -> Parsed {
    let mut p = Parsed::default();
    for v in lines {
        let ts = s(&v, "timestamp");
        let pl = v.get("payload").cloned().unwrap_or(Value::Null);
        match v.get("type").and_then(Value::as_str).unwrap_or("") {
            "session_meta" => {
                p.meta.session_id = s(&pl, "id").or_else(|| s(&pl, "session_id"));
                p.meta.cwd = s(&pl, "cwd");
                p.touch(s(&pl, "timestamp").as_deref().or(ts.as_deref()));
            }
            "turn_context" => {
                if let Some(m) = s(&pl, "model") {
                    p.meta.model = Some(m);
                }
            }
            "response_item" => {
                p.touch(ts.as_deref());
                codex_item(&mut p, &pl, ts);
            }
            _ => {}
        }
    }
    p
}

fn codex_item(p: &mut Parsed, pl: &Value, ts: Option<String>) {
    match pl.get("type").and_then(Value::as_str).unwrap_or("") {
        "message" => {
            let role = pl.get("role").and_then(Value::as_str).unwrap_or("assistant");
            let text = flatten(pl.get("content").unwrap_or(&Value::Null));
            if text.trim().is_empty() {
                return;
            }
            let (role, kind) = match role {
                "user" if is_injected(&text) => ("user", "meta"),
                "user" => ("user", "text"),
                "developer" | "system" => ("system", "meta"),
                _ => ("assistant", "text"),
            };
            p.msgs.push(Msg::new(role, kind, text).at(ts));
        }
        "reasoning" => {
            let text = flatten(pl.get("summary").unwrap_or(&Value::Null));
            if !text.trim().is_empty() {
                p.msgs.push(Msg::new("assistant", "thinking", text).at(ts));
            }
        }
        "function_call" | "custom_tool_call" | "local_shell_call" | "web_search_call" => {
            let args = pl.get("arguments").or_else(|| pl.get("input")).or_else(|| pl.get("action")).unwrap_or(&Value::Null);
            let args = match args {
                Value::String(s) => serde_json::from_str::<Value>(s).map(|v| pretty(&v)).unwrap_or_else(|_| s.clone()),
                other => pretty(other),
            };
            let name = s(pl, "name").or_else(|| s(pl, "type"));
            p.msgs.push(Msg::new("assistant", "tool_call", truncate(&args, TOOL_MAX)).named(name).at(ts));
        }
        "function_call_output" | "custom_tool_call_output" => {
            let out = flatten(pl.get("output").unwrap_or(&Value::Null));
            p.msgs.push(Msg::new("tool", "tool_result", truncate(&out, TOOL_MAX)).at(ts));
        }
        _ => {}
    }
}

// ---------------- Gemini CLI ----------------

pub fn gemini(v: &Value) -> Parsed {
    let mut p = Parsed::default();
    p.meta.session_id = s(v, "sessionId");
    p.meta.title = s(v, "summary").map(|t| first_line(&t, 120));
    p.meta.started = s(v, "startTime");
    p.meta.updated = s(v, "lastUpdated");
    for m in v.get("messages").and_then(Value::as_array).into_iter().flatten() {
        let ts = s(m, "timestamp");
        let content = flatten(m.get("content").unwrap_or(&Value::Null));
        match m.get("type").and_then(Value::as_str).unwrap_or("") {
            "user" => {
                if !content.trim().is_empty() {
                    p.msgs.push(Msg::new("user", "text", content).at(ts));
                }
            }
            "gemini" => {
                if let Some(model) = s(m, "model") {
                    p.meta.model = Some(model);
                }
                for th in m.get("thoughts").and_then(Value::as_array).into_iter().flatten() {
                    let text = [s(th, "subject"), s(th, "description")].into_iter().flatten().collect::<Vec<_>>().join("\n");
                    if !text.trim().is_empty() {
                        p.msgs.push(Msg::new("assistant", "thinking", text).at(ts.clone()));
                    }
                }
                if !content.trim().is_empty() {
                    p.msgs.push(Msg::new("assistant", "text", content).at(ts.clone()));
                }
                for tc in m.get("toolCalls").and_then(Value::as_array).into_iter().flatten() {
                    let name = s(tc, "displayName").or_else(|| s(tc, "name"));
                    let args = pretty(tc.get("args").unwrap_or(&Value::Null));
                    p.msgs.push(Msg::new("assistant", "tool_call", truncate(&args, TOOL_MAX)).named(name).at(ts.clone()));
                    let res = tc.get("resultDisplay").filter(|r| r.is_string()).or_else(|| tc.get("result"));
                    if let Some(r) = res {
                        p.msgs.push(Msg::new("tool", "tool_result", truncate(&gemini_result(r), TOOL_MAX)).at(ts.clone()));
                    }
                }
            }
            _ => {
                if !content.trim().is_empty() {
                    p.msgs.push(Msg::new("system", "meta", content).at(ts));
                }
            }
        }
    }
    p
}

/// Gemini tool results are often [{functionResponse:{response:{output}}}].
fn gemini_result(r: &Value) -> String {
    if let Some(arr) = r.as_array() {
        let parts: Vec<String> = arr
            .iter()
            .map(|x| {
                x.pointer("/functionResponse/response/output")
                    .map(flatten)
                    .unwrap_or_else(|| pretty(x))
            })
            .collect();
        return parts.join("\n");
    }
    flatten(r)
}
