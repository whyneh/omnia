//! Path resolution and safety: globs are resolved under the agent root,
//! credential files are always excluded, and every read is checked against
//! the set of files the agent's configured globs actually match.

use crate::config::Agent;
use std::path::{Path, PathBuf};

const DENY_NAMES: &[&str] = &[
    "auth.json",
    "auth.lock",
    "oauth_creds.json",
    "google_accounts.json",
    ".credentials.json",
    "credentials.json",
    ".env",
    "cap_sid",
    "installation_id",
];
const DENY_DIRS: &[&str] = &["accounts", "mcp-oauth-locks"];
const DENY_EXT: &[&str] = &["pem", "key", "p12", "pfx"];

pub fn is_denied(p: &Path) -> bool {
    let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    if DENY_NAMES.contains(&name.as_str()) || name.starts_with(".env.") || name.contains("credential") {
        return true;
    }
    if let Some(ext) = p.extension() {
        if DENY_EXT.contains(&ext.to_string_lossy().to_lowercase().as_str()) {
            return true;
        }
    }
    p.components().any(|c| {
        let s = c.as_os_str().to_string_lossy().to_lowercase();
        DENY_DIRS.contains(&s.as_str())
    })
}

/// Normalize to an absolute, symlink-resolved path with forward slashes.
pub fn canon(p: &Path) -> Option<PathBuf> {
    dunce::canonicalize(p).ok()
}

pub fn display(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

fn is_absolute_pattern(pat: &str) -> bool {
    let b = pat.as_bytes();
    pat.starts_with('/') || pat.starts_with('\\') || (b.len() > 2 && b[1] == b':')
}

/// Expand one glob relative to the agent root (absolute patterns are used as-is).
pub fn expand(root: &str, pattern: &str) -> Vec<PathBuf> {
    let pattern = pattern.trim();
    if pattern.is_empty() {
        return vec![];
    }
    let full = if is_absolute_pattern(pattern) {
        pattern.replace('\\', "/")
    } else {
        let root = root.replace('\\', "/");
        let root = root.trim_end_matches('/');
        format!("{}/{}", glob::Pattern::escape(root), pattern.trim_start_matches("./"))
    };
    let opts = glob::MatchOptions { case_sensitive: false, require_literal_separator: true, require_literal_leading_dot: false };
    let Ok(iter) = glob::glob_with(&full, opts) else { return vec![] };
    iter.filter_map(Result::ok)
        .filter(|p| p.is_file() && !is_denied(p))
        .filter_map(|p| canon(&p))
        .filter(|p| !is_denied(p))
        .collect()
}

/// All files matched by the agent's globs for one kind (deduplicated, sorted).
pub fn files(agent: &Agent, kind: &str) -> Vec<PathBuf> {
    let Some(pats) = agent.paths.get(kind) else { return vec![] };
    let mut out: Vec<PathBuf> = pats.iter().flat_map(|p| expand(&agent.root, p)).collect();
    out.sort();
    out.dedup();
    out
}

/// Verify that `path` is one of the files this agent exposes for `kind`.
pub fn check(agent: &Agent, kind: &str, path: &str) -> Result<PathBuf, String> {
    let p = canon(Path::new(path)).ok_or("文件不存在")?;
    if is_denied(&p) {
        return Err("拒绝访问：凭据文件".into());
    }
    if files(agent, kind).iter().any(|f| f == &p) {
        Ok(p)
    } else {
        Err("拒绝访问：路径不在该 agent 的配置范围内".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn denies_credentials() {
        assert!(is_denied(Path::new("C:/u/.codex/auth.json")));
        assert!(is_denied(Path::new("C:/u/.gemini/oauth_creds.json")));
        assert!(is_denied(Path::new("C:/u/.codex/accounts/a.json")));
        assert!(is_denied(Path::new("C:/u/.claude/.credentials.json")));
        assert!(is_denied(Path::new("C:/u/x/.env.local")));
        assert!(!is_denied(Path::new("C:/u/.claude/skills/x/SKILL.md")));
    }
}
