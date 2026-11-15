use serde::{Deserialize, Serialize};

/// One rendered unit of a conversation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Msg {
    /// user | assistant | system | tool
    pub role: String,
    /// text | thinking | tool_call | tool_result | meta | raw
    pub kind: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ts: Option<String>,
}

impl Msg {
    pub fn new(role: &str, kind: &str, text: impl Into<String>) -> Self {
        Msg { role: role.into(), kind: kind.into(), text: text.into(), name: None, ts: None }
    }
    pub fn named(mut self, name: Option<String>) -> Self {
        self.name = name;
        self
    }
    pub fn at(mut self, ts: Option<String>) -> Self {
        self.ts = ts;
        self
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionMeta {
    pub session_id: Option<String>,
    pub title: Option<String>,
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub started: Option<String>,
    pub updated: Option<String>,
}

#[derive(Debug, Default)]
pub struct Parsed {
    pub meta: SessionMeta,
    pub msgs: Vec<Msg>,
}

impl Parsed {
    /// Track first/last timestamp seen.
    pub fn touch(&mut self, ts: Option<&str>) {
        if let Some(t) = ts {
            if self.meta.started.is_none() {
                self.meta.started = Some(t.to_string());
            }
            self.meta.updated = Some(t.to_string());
        }
    }
    /// Fallback title: first non-meta user text.
    pub fn finish(mut self) -> Self {
        if self.meta.title.is_none() {
            self.meta.title = self
                .msgs
                .iter()
                .find(|m| m.role == "user" && m.kind == "text" && !m.text.trim_start().starts_with('<'))
                .map(|m| first_line(&m.text, 120));
        }
        self
    }
}

pub fn first_line(s: &str, max: usize) -> String {
    let line = s.trim().lines().next().unwrap_or("").trim();
    truncate(line, max)
}

pub fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max).collect();
        out.push('…');
        out
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionRow {
    pub agent_id: String,
    pub path: String,
    pub session_id: Option<String>,
    pub title: Option<String>,
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub started: Option<String>,
    pub updated: Option<String>,
    pub msg_count: i64,
    pub size: i64,
    pub mtime: i64,
    pub snippet: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Item {
    pub name: String,
    pub path: String,
    pub description: Option<String>,
    pub source: Option<String>,
    pub size: u64,
    pub mtime: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionPage {
    pub meta: SessionMeta,
    pub total: usize,
    pub offset: usize,
    pub msgs: Vec<Msg>,
}
