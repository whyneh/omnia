//! Skills, commands and instruction files.

use crate::config::Agent;
use crate::guard;
use crate::model::{truncate, Item};
use std::path::Path;

pub const READ_MAX: u64 = 2 * 1024 * 1024;

fn mtime(md: &std::fs::Metadata) -> i64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Read the head of a file (enough for frontmatter) without loading big files.
fn head(path: &Path, max: usize) -> String {
    use std::io::Read;
    let mut buf = vec![0u8; max];
    let n = std::fs::File::open(path).and_then(|mut f| f.read(&mut buf)).unwrap_or(0);
    String::from_utf8_lossy(&buf[..n]).into_owned()
}

/// Minimal YAML frontmatter reader: top-level `key: value` pairs, with
/// support for `key: >`/`|` folded blocks and quoted values.
pub fn frontmatter(text: &str) -> Vec<(String, String)> {
    let text = text.trim_start_matches('\u{feff}');
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        return vec![];
    }
    let mut out: Vec<(String, String)> = vec![];
    let mut block: Option<String> = None;
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        let indented = line.starts_with(' ') || line.starts_with('\t');
        if indented {
            if let (Some(k), Some(last)) = (&block, out.last_mut()) {
                if &last.0 == k {
                    if !last.1.is_empty() {
                        last.1.push(' ');
                    }
                    last.1.push_str(line.trim());
                }
            }
            continue;
        }
        block = None;
        if let Some((k, v)) = line.split_once(':') {
            let k = k.trim().to_string();
            let v = v.trim();
            if v.is_empty() || v == ">" || v == "|" || v == ">-" || v == "|-" {
                block = Some(k.clone());
                out.push((k, String::new()));
            } else {
                out.push((k, v.trim_matches('"').trim_matches('\'').to_string()));
            }
        }
    }
    out
}

/// TOML commands (Gemini): pick up `description = "..."`.
fn toml_description(text: &str) -> Option<String> {
    text.lines().find_map(|l| {
        let (k, v) = l.split_once('=')?;
        (k.trim() == "description").then(|| v.trim().trim_matches('"').trim_matches('\'').to_string())
    })
}

/// Where a file came from, relative to root: "plugins/cache/x/superpowers/5.1.0" -> "superpowers".
fn source_of(root: &str, path: &Path) -> Option<String> {
    let p = guard::display(path);
    let root = guard::display(&guard::canon(Path::new(root))?);
    let rel = p.strip_prefix(&root)?.trim_start_matches('/');
    let parts: Vec<&str> = rel.split('/').collect();
    if parts.first() == Some(&"plugins") {
        return parts.get(3).map(|s| format!("插件 {s}"));
    }
    if parts.get(1) == Some(&".system") {
        return Some("系统".into());
    }
    None
}

pub fn list(agent: &Agent, kind: &str) -> Vec<Item> {
    let mut items: Vec<Item> = guard::files(agent, kind)
        .into_iter()
        .filter_map(|p| {
            let md = std::fs::metadata(&p).ok()?;
            let text = head(&p, 16 * 1024);
            let fm = frontmatter(&text);
            let get = |k: &str| fm.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone()).filter(|v| !v.is_empty());
            let file_stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            let name = match kind {
                // skills/<name>/SKILL.md -> folder name unless frontmatter says otherwise
                "skills" => get("name").unwrap_or_else(|| {
                    p.parent().and_then(|d| d.file_name()).map(|s| s.to_string_lossy().into_owned()).unwrap_or(file_stem)
                }),
                "instructions" => guard::display(&p).rsplit('/').next().unwrap_or("").to_string(),
                _ => file_stem,
            };
            let description = get("description")
                .or_else(|| toml_description(&text))
                .or_else(|| {
                    // first prose line after frontmatter
                    let body = if fm.is_empty() { text.as_str() } else { text.splitn(3, "---").nth(2).unwrap_or("") };
                    body.lines().map(str::trim).find(|l| !l.is_empty() && !l.starts_with('#')).map(|l| l.to_string())
                })
                .map(|d| truncate(&d, 300));
            Some(Item {
                name,
                description,
                source: source_of(&agent.root, &p),
                path: guard::display(&p),
                size: md.len(),
                mtime: mtime(&md),
            })
        })
        .collect();
    items.sort_by(|a, b| a.source.is_some().cmp(&b.source.is_some()).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    items
}

pub fn read_text(path: &Path) -> Result<String, String> {
    let md = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if md.len() > READ_MAX {
        let mut s = head(path, READ_MAX as usize);
        s.push_str("\n\n… [文件过大，仅显示前 2 MB]");
        return Ok(s);
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_frontmatter() {
        let fm = frontmatter("---\nname: think\ndescription: >\n  Turns ideas\n  into plans\nversion: \"1\"\n---\n# body");
        assert_eq!(fm[0], ("name".into(), "think".into()));
        assert_eq!(fm[1], ("description".into(), "Turns ideas into plans".into()));
        assert_eq!(fm[2], ("version".into(), "1".into()));
        assert!(frontmatter("# no fm").is_empty());
    }
}
