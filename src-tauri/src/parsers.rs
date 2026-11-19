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

fn known_model(v: &Value) -> Option<&str> {
    let model = v.get("model")?.as_str()?.trim();
    // Claude logs can mark synthetic replies with an angle-bracket placeholder.
    (!model.is_empty() && !model.starts_with('<')).then_some(model)
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
                let model = if t == "assistant" { known_model(msg) } else { None };
                if let Some(model) = model {
                    p.meta.model = Some(model.to_owned());
                }
                let meta = v.get("isMeta").and_then(Value::as_bool).unwrap_or(false);
                claude_content(&mut p, t, msg.get("content").unwrap_or(&Value::Null), meta, ts, model);
            }
            _ => {}
        }
    }
    p
}

fn claude_content(p: &mut Parsed, role: &str, content: &Value, meta: bool, ts: Option<String>, model: Option<&str>) {
    let push_text = |p: &mut Parsed, text: &str| {
        if text.trim().is_empty() {
            return;
        }
        let kind = if meta || (role == "user" && is_injected(text)) { "meta" } else { "text" };
        p.msgs.push(Msg::new(role, kind, text).at(ts.clone()).with_model(model));
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
                            p.msgs.push(Msg::new("assistant", "thinking", t).at(ts.clone()).with_model(model));
                        }
                    }
                    "tool_use" => p.msgs.push(
                        Msg::new("assistant", "tool_call", truncate(&pretty(b.get("input").unwrap_or(&Value::Null)), TOOL_MAX))
                            .named(s(b, "name"))
                            .at(ts.clone())
                            .with_model(model),
                    ),
                    "tool_result" => p.msgs.push(
                        Msg::new("tool", "tool_result", truncate(&flatten(b.get("content").unwrap_or(&Value::Null)), TOOL_MAX))
                            .at(ts.clone()),
                    ),
                    "image" => p.msgs.push(Msg::new(role, "meta", "[图片]").at(ts.clone())),
                    "redacted_thinking" => {}
                    // Unrecognized blocks may be server tool results, not generated output.
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
    let mut turn_model = None;
    for v in lines {
        let ts = s(&v, "timestamp");
        let pl = v.get("payload").unwrap_or(&Value::Null);
        match v.get("type").and_then(Value::as_str).unwrap_or("") {
            "session_meta" => {
                p.meta.session_id = s(pl, "id").or_else(|| s(pl, "session_id"));
                p.meta.cwd = s(pl, "cwd");
                p.touch(s(pl, "timestamp").as_deref().or(ts.as_deref()));
            }
            "turn_context" => {
                // Context applies forward in file order; never use it to relabel earlier items.
                // A model-less context clears the current turn, not the session summary.
                turn_model = known_model(pl).map(str::to_owned);
                if turn_model.is_some() {
                    p.meta.model = turn_model.clone();
                }
            }
            "response_item" => {
                p.touch(ts.as_deref());
                codex_item(&mut p, pl, ts, turn_model.as_deref());
            }
            _ => {}
        }
    }
    p
}

fn codex_item(p: &mut Parsed, pl: &Value, ts: Option<String>, model: Option<&str>) {
    match pl.get("type").and_then(Value::as_str).unwrap_or("") {
        "message" => {
            let source_role = pl.get("role").and_then(Value::as_str);
            let text = flatten(pl.get("content").unwrap_or(&Value::Null));
            if text.trim().is_empty() {
                return;
            }
            // Rendering defaults unknown roles to assistant; attribution does not.
            let model = if source_role == Some("assistant") { model } else { None };
            let (role, kind) = match source_role.unwrap_or("assistant") {
                "user" if is_injected(&text) => ("user", "meta"),
                "user" => ("user", "text"),
                "developer" | "system" => ("system", "meta"),
                _ => ("assistant", "text"),
            };
            p.msgs.push(Msg::new(role, kind, text).at(ts).with_model(model));
        }
        "reasoning" => {
            let text = flatten(pl.get("summary").unwrap_or(&Value::Null));
            if !text.trim().is_empty() {
                p.msgs.push(Msg::new("assistant", "thinking", text).at(ts).with_model(model));
            }
        }
        "function_call" | "custom_tool_call" | "local_shell_call" | "web_search_call" => {
            let args = pl.get("arguments").or_else(|| pl.get("input")).or_else(|| pl.get("action")).unwrap_or(&Value::Null);
            let args = match args {
                Value::String(s) => serde_json::from_str::<Value>(s).map(|v| pretty(&v)).unwrap_or_else(|_| s.clone()),
                other => pretty(other),
            };
            let name = s(pl, "name").or_else(|| s(pl, "type"));
            p.msgs.push(Msg::new("assistant", "tool_call", truncate(&args, TOOL_MAX)).named(name).at(ts).with_model(model));
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
                let model = known_model(m);
                if let Some(model) = model {
                    p.meta.model = Some(model.to_owned());
                }
                for th in m.get("thoughts").and_then(Value::as_array).into_iter().flatten() {
                    let text = [s(th, "subject"), s(th, "description")].into_iter().flatten().collect::<Vec<_>>().join("\n");
                    if !text.trim().is_empty() {
                        p.msgs.push(Msg::new("assistant", "thinking", text).at(ts.clone()).with_model(model));
                    }
                }
                if !content.trim().is_empty() {
                    p.msgs.push(Msg::new("assistant", "text", content).at(ts.clone()).with_model(model));
                }
                for tc in m.get("toolCalls").and_then(Value::as_array).into_iter().flatten() {
                    let name = s(tc, "displayName").or_else(|| s(tc, "name"));
                    let args = pretty(tc.get("args").unwrap_or(&Value::Null));
                    p.msgs.push(Msg::new("assistant", "tool_call", truncate(&args, TOOL_MAX)).named(name).at(ts.clone()).with_model(model));
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn assert_models(parsed: &Parsed, expected: &[(&str, &str, Option<&str>)]) {
        let actual: Vec<_> = parsed.msgs.iter()
            .map(|m| (m.role.as_str(), m.kind.as_str(), m.model.as_deref()))
            .collect();
        assert_eq!(actual.as_slice(), expected);
    }

    #[test]
    fn claude_uses_each_assistant_records_model() {
        let parsed = claude(vec![
            json!({"type":"assistant", "message":{"content":"before model metadata"}}),
            json!({"type":"assistant", "message":{"model":"claude-sonnet-4-5", "content":[
                {"type":"thinking", "thinking":"plan"},
                {"type":"text", "text":"first reply"},
                {"type":"tool_use", "name":"Read", "input":{"path":"file"}},
                {"type":"web_search_tool_result", "content":[]}
            ]}}),
            json!({"type":"user", "message":{"model":"not-a-user-model", "content":[
                {"type":"tool_result", "content":"result"},
                {"type":"text", "text":"next prompt"}
            ]}}),
            json!({"type":"assistant", "message":{"model":" ", "content":"model unspecified"}}),
            json!({"type":"assistant", "message":{"model":"claude-opus-4-5", "content":"switched"}}),
            json!({"type":"assistant", "message":{"model":"<synthetic>", "content":"local notice"}}),
        ]);
        assert_models(&parsed, &[
            ("assistant", "text", None),
            ("assistant", "thinking", Some("claude-sonnet-4-5")),
            ("assistant", "text", Some("claude-sonnet-4-5")),
            ("assistant", "tool_call", Some("claude-sonnet-4-5")),
            ("assistant", "raw", None),
            ("tool", "tool_result", None),
            ("user", "text", None),
            ("assistant", "text", None),
            ("assistant", "text", Some("claude-opus-4-5")),
            ("assistant", "text", None),
        ]);
        assert_eq!(parsed.meta.model.as_deref(), Some("claude-opus-4-5"));
    }

    #[test]
    fn codex_model_context_applies_only_to_subsequent_items() {
        let parsed = codex(vec![
            json!({"type":"response_item", "payload":{"type":"message", "role":"assistant", "content":"before context"}}),
            json!({"type":"turn_context", "payload":{"model":"gpt-5"}}),
            json!({"type":"response_item", "payload":{"type":"message", "role":"developer", "content":"instructions"}}),
            json!({"type":"response_item", "payload":{"type":"message", "role":"user", "content":"prompt"}}),
            json!({"type":"response_item", "payload":{"type":"reasoning", "summary":[{"type":"summary_text", "text":"plan"}]}}),
            json!({"type":"response_item", "payload":{"type":"function_call", "name":"read", "arguments":"{}"}}),
            json!({"type":"response_item", "payload":{"type":"function_call_output", "output":"result"}}),
            json!({"type":"response_item", "payload":{"type":"message", "role":"assistant", "content":"first reply"}}),
            json!({"type":"turn_context", "payload":{"model":"gpt-5.1-codex"}}),
            json!({"type":"response_item", "payload":{"type":"message", "role":"assistant", "content":"switched"}}),
            json!({"type":"turn_context", "payload":{}}),
            json!({"type":"response_item", "payload":{"type":"message", "role":"assistant", "content":"model unspecified"}}),
        ]);
        assert_models(&parsed, &[
            ("assistant", "text", None),
            ("system", "meta", None),
            ("user", "text", None),
            ("assistant", "thinking", Some("gpt-5")),
            ("assistant", "tool_call", Some("gpt-5")),
            ("tool", "tool_result", None),
            ("assistant", "text", Some("gpt-5")),
            ("assistant", "text", Some("gpt-5.1-codex")),
            ("assistant", "text", None),
        ]);
        assert_eq!(parsed.meta.model.as_deref(), Some("gpt-5.1-codex"));
    }

    #[test]
    fn gemini_uses_only_the_model_on_each_gemini_message() {
        let parsed = gemini(&json!({"messages":[
            {"type":"gemini", "content":"before model metadata"},
            {"type":"user", "model":"not-a-user-model", "content":"prompt"},
            {"type":"gemini", "model":"gemini-2.5-pro", "content":"first reply",
                "thoughts":[{"subject":"plan"}],
                "toolCalls":[{"name":"read_file", "args":{}, "resultDisplay":"result"}]},
            {"type":"gemini", "content":"model unspecified"},
            {"type":"gemini", "model":"gemini-2.5-flash", "content":"switched"},
            {"type":"info", "model":"not-a-system-model", "content":"notice"},
            {"type":"gemini", "model":null, "content":"model unspecified again"}
        ]}));
        assert_models(&parsed, &[
            ("assistant", "text", None),
            ("user", "text", None),
            ("assistant", "thinking", Some("gemini-2.5-pro")),
            ("assistant", "text", Some("gemini-2.5-pro")),
            ("assistant", "tool_call", Some("gemini-2.5-pro")),
            ("tool", "tool_result", None),
            ("assistant", "text", None),
            ("assistant", "text", Some("gemini-2.5-flash")),
            ("system", "meta", None),
            ("assistant", "text", None),
        ]);
        assert_eq!(parsed.meta.model.as_deref(), Some("gemini-2.5-flash"));
    }
}
