use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Paths {
    #[serde(default)]
    pub sessions: Vec<String>,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub commands: Vec<String>,
    #[serde(default)]
    pub instructions: Vec<String>,
}

impl Paths {
    pub fn get(&self, kind: &str) -> Option<&Vec<String>> {
        match kind {
            "sessions" => Some(&self.sessions),
            "skills" => Some(&self.skills),
            "commands" => Some(&self.commands),
            "instructions" => Some(&self.instructions),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Agent {
    pub id: String,
    pub name: String,
    /// claude | codex | gemini | generic
    #[serde(rename = "type")]
    pub kind: String,
    pub root: String,
    pub paths: Paths,
    #[serde(default = "yes")]
    pub enabled: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub agents: Vec<Agent>,
}

fn v(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

pub fn default_paths(kind: &str) -> Paths {
    match kind {
        "claude" => Paths {
            sessions: v(&["projects/*/*.jsonl"]),
            skills: v(&["skills/*/SKILL.md", "plugins/cache/*/*/*/skills/*/SKILL.md"]),
            commands: v(&["commands/**/*.md"]),
            instructions: v(&["CLAUDE.md"]),
        },
        "codex" => Paths {
            sessions: v(&["sessions/**/*.jsonl", "archived_sessions/**/*.jsonl"]),
            skills: v(&["skills/*/SKILL.md", "skills/.system/*/SKILL.md"]),
            commands: v(&["prompts/*.md"]),
            instructions: v(&["AGENTS.md"]),
        },
        "gemini" => Paths {
            sessions: v(&["tmp/*/chats/session-*.json"]),
            skills: v(&["skills/*/SKILL.md"]),
            commands: v(&["commands/**/*.toml"]),
            instructions: v(&["GEMINI.md"]),
        },
        _ => Paths { skills: v(&["skills/*/SKILL.md"]), ..Default::default() },
    }
}

pub fn default_name(kind: &str) -> &'static str {
    match kind {
        "claude" => "Claude Code",
        "codex" => "Codex",
        "gemini" => "Gemini",
        _ => "Agent",
    }
}

/// Guess the agent type from signature files in the folder.
pub fn detect_kind(root: &Path) -> String {
    let has = |p: &str| root.join(p).exists();
    let is_dir = |p: &str| root.join(p).is_dir();
    if has("config.toml") && (is_dir("sessions") || has("AGENTS.md")) {
        "codex".into()
    } else if is_dir("projects") && (has("settings.json") || has("CLAUDE.md") || is_dir("todos")) {
        "claude".into()
    } else if is_dir("tmp") && (has("settings.json") || has("GEMINI.md")) {
        "gemini".into()
    } else {
        "generic".into()
    }
}

pub fn omnia_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".omnia")
}

pub fn config_path() -> PathBuf {
    omnia_dir().join("config.json")
}

/// Load config. On first run, auto-detect well-known agent folders.
/// On a corrupt file, keep a copy aside and fall back to detection; return a warning.
pub fn load() -> (Config, Option<String>) {
    let path = config_path();
    match std::fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<Config>(&text) {
            Ok(c) => (c, None),
            Err(e) => {
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let bad = path.with_file_name(format!("config.broken-{ts}.json"));
                let _ = std::fs::rename(&path, &bad);
                let c = first_run();
                let _ = save(&c);
                (c, Some(format!("配置文件损坏（{e}），已备份为 {} 并恢复默认", bad.display())))
            }
        },
        Err(_) => {
            let c = first_run();
            let _ = save(&c);
            (c, None)
        }
    }
}

fn first_run() -> Config {
    let mut agents = vec![];
    if let Some(home) = dirs::home_dir() {
        for (dir, kind) in [(".claude", "claude"), (".codex", "codex"), (".gemini", "gemini")] {
            let root = home.join(dir);
            if root.is_dir() {
                agents.push(Agent {
                    id: kind.into(),
                    name: default_name(kind).into(),
                    kind: kind.into(),
                    root: root.to_string_lossy().replace('\\', "/"),
                    paths: default_paths(kind),
                    enabled: true,
                });
            }
        }
    }
    Config { version: 1, agents }
}

pub fn save(c: &Config) -> Result<(), String> {
    let dir = omnia_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("config.json.tmp");
    let text = serde_json::to_string_pretty(c).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, config_path()).map_err(|e| e.to_string())
}
