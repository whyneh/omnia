//! Session index cache at ~/.omnia/index.db. Pure cache: safe to delete.

use crate::config::Agent;
use crate::guard;
use crate::model::SessionRow;
use crate::parsers;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

const SCHEMA_VERSION: i64 = 1;
const BODY_MAX: usize = 400_000;

pub fn open(path: &Path) -> Result<Connection, String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    init(&conn)?;
    Ok(conn)
}

pub fn init(conn: &Connection) -> Result<(), String> {
    let ver: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if ver != SCHEMA_VERSION {
        conn.execute_batch("DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS fts;").map_err(|e| e.to_string())?;
    }
    conn.execute_batch(&format!(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS sessions(
           path TEXT PRIMARY KEY, agent_id TEXT NOT NULL, size INTEGER, mtime INTEGER,
           session_id TEXT, title TEXT, cwd TEXT, model TEXT, started TEXT, updated TEXT, msg_count INTEGER);
         CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
         CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(path UNINDEXED, title, body, tokenize='trigram');
         PRAGMA user_version={SCHEMA_VERSION};"
    ))
    .map_err(|e| e.to_string())
}

#[derive(Debug, Default, Serialize)]
pub struct Stats {
    pub scanned: usize,
    pub updated: usize,
    pub removed: usize,
    pub failed: usize,
}

fn mtime_of(md: &std::fs::Metadata) -> i64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Incrementally sync one agent: reparse files whose size/mtime changed,
/// drop rows for files no longer matched.
pub fn refresh(conn: &mut Connection, agent: &Agent) -> Result<Stats, String> {
    let mut stats = Stats::default();
    let files = if agent.enabled { guard::files(agent, "sessions") } else { vec![] };
    let mut known: HashMap<String, (i64, i64)> = HashMap::new();
    {
        let mut st = conn.prepare("SELECT path,size,mtime FROM sessions WHERE agent_id=?1").map_err(|e| e.to_string())?;
        let rows = st
            .query_map([&agent.id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))
            .map_err(|e| e.to_string())?;
        for r in rows.flatten() {
            known.insert(r.0, (r.1, r.2));
        }
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for f in &files {
        stats.scanned += 1;
        let key = guard::display(f);
        let Ok(md) = std::fs::metadata(f) else { continue };
        let (size, mtime) = (md.len() as i64, mtime_of(&md));
        if known.remove(&key) == Some((size, mtime)) {
            continue;
        }
        match parsers::parse_file(&agent.kind, f) {
            Ok(p) => {
                let body: String = p
                    .msgs
                    .iter()
                    .filter(|m| m.kind == "text" || m.kind == "raw")
                    .map(|m| m.text.as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                let body: String = body.chars().take(BODY_MAX).collect();
                let count = p.msgs.iter().filter(|m| m.kind == "text").count() as i64;
                let m = &p.meta;
                tx.execute("DELETE FROM fts WHERE path=?1", [&key]).map_err(|e| e.to_string())?;
                tx.execute(
                    "INSERT OR REPLACE INTO sessions(path,agent_id,size,mtime,session_id,title,cwd,model,started,updated,msg_count)
                     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                    params![key, agent.id, size, mtime, m.session_id, m.title, m.cwd, m.model, m.started, m.updated, count],
                )
                .map_err(|e| e.to_string())?;
                tx.execute("INSERT INTO fts(path,title,body) VALUES(?1,?2,?3)", params![key, m.title.clone().unwrap_or_default(), body])
                    .map_err(|e| e.to_string())?;
                stats.updated += 1;
            }
            Err(_) => stats.failed += 1,
        }
    }
    for (gone, _) in known {
        tx.execute("DELETE FROM sessions WHERE path=?1", [&gone]).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM fts WHERE path=?1", [&gone]).map_err(|e| e.to_string())?;
        stats.removed += 1;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(stats)
}

pub fn forget(conn: &Connection, agent_id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM fts WHERE path IN (SELECT path FROM sessions WHERE agent_id=?1)", [agent_id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sessions WHERE agent_id=?1", [agent_id]).map_err(|e| e.to_string())?;
    Ok(())
}

const COLS: &str = "s.agent_id,s.path,s.session_id,s.title,s.cwd,s.model,s.started,s.updated,s.msg_count,s.size,s.mtime";

fn row(r: &rusqlite::Row, snippet: bool) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        agent_id: r.get(0)?,
        path: r.get(1)?,
        session_id: r.get(2)?,
        title: r.get(3)?,
        cwd: r.get(4)?,
        model: r.get(5)?,
        started: r.get(6)?,
        updated: r.get(7)?,
        msg_count: r.get(8)?,
        size: r.get(9)?,
        mtime: r.get(10)?,
        snippet: if snippet { r.get(11)? } else { None },
    })
}

/// A working folder that sessions were started in — the sidebar's "project".
#[derive(Debug, Clone, Serialize)]
pub struct Project {
    pub path: String,
    pub sessions: i64,
    pub updated: Option<String>,
    pub mtime: i64,
}

/// Distinct session cwds for the given agents, most recently used first.
pub fn projects(conn: &Connection, agents: &[String]) -> Result<Vec<Project>, String> {
    if agents.is_empty() {
        return Ok(vec![]);
    }
    let marks = (0..agents.len()).map(|i| format!("?{}", i + 1)).collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT s.cwd, COUNT(*), MAX(NULLIF(COALESCE(s.updated,''),'')), MAX(s.mtime)
         FROM sessions s
         WHERE s.cwd IS NOT NULL AND s.cwd <> '' AND s.agent_id IN ({marks})
         GROUP BY s.cwd
         ORDER BY 3 DESC, 4 DESC"
    );
    let mut st = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let args: Vec<&dyn rusqlite::ToSql> = agents.iter().map(|a| a as &dyn rusqlite::ToSql).collect();
    let rows = st
        .query_map(args.as_slice(), |r| {
            Ok(Project { path: r.get(0)?, sessions: r.get(1)?, updated: r.get(2)?, mtime: r.get(3)? })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.flatten().collect())
}

/// List sessions, optionally filtered by agent ids, one project folder, and a
/// full-text query. Queries of 3+ chars use the trigram FTS index; shorter ones
/// fall back to LIKE.
pub fn search(
    conn: &Connection,
    agents: &[String],
    query: &str,
    project: Option<&str>,
    limit: i64,
) -> Result<Vec<SessionRow>, String> {
    if agents.is_empty() {
        return Ok(vec![]);
    }
    let marks = (0..agents.len()).map(|i| format!("?{}", i + 4)).collect::<Vec<_>>().join(",");
    let q = query.trim();
    let sql = if q.is_empty() {
        format!(
            "SELECT {COLS} FROM sessions s
             WHERE ?1 IS NOT NULL AND (?3 IS NULL OR s.cwd = ?3) AND s.agent_id IN ({marks})
             ORDER BY COALESCE(s.updated,'') DESC, s.mtime DESC LIMIT ?2"
        )
    } else if q.chars().count() >= 3 {
        format!(
            "SELECT {COLS}, snippet(fts,2,'«','»','…',24) FROM fts JOIN sessions s ON s.path=fts.path
             WHERE fts MATCH ?1 AND (?3 IS NULL OR s.cwd = ?3) AND s.agent_id IN ({marks}) ORDER BY rank LIMIT ?2"
        )
    } else {
        format!(
            "SELECT {COLS}, substr(fts.body, max(1, instr(lower(fts.body), lower(?1)) - 30), 90) FROM fts JOIN sessions s ON s.path=fts.path
             WHERE (fts.body LIKE '%'||?1||'%' OR fts.title LIKE '%'||?1||'%')
               AND (?3 IS NULL OR s.cwd = ?3) AND s.agent_id IN ({marks})
             ORDER BY COALESCE(s.updated,'') DESC LIMIT ?2"
        )
    };
    let first: String = if q.chars().count() >= 3 { fts_quote(q) } else { q.to_string() };
    let mut args: Vec<&dyn rusqlite::ToSql> = vec![&first, &limit, &project];
    for a in agents {
        args.push(a);
    }
    let mut st = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let snippet = !q.is_empty();
    let rows = st.query_map(args.as_slice(), |r| row(r, snippet)).map_err(|e| e.to_string())?;
    Ok(rows.flatten().collect())
}

/// Treat user input as literal phrases joined by AND (no FTS syntax injection).
fn fts_quote(q: &str) -> String {
    let quote = |t: &str| format!("\"{}\"", t.replace('"', "\"\""));
    let parts: Vec<String> = q.split_whitespace().filter(|t| t.chars().count() >= 3).map(quote).collect();
    if parts.is_empty() {
        quote(q.trim())
    } else {
        parts.join(" ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoting_neutralizes_syntax() {
        assert_eq!(fts_quote("foo OR bar"), "\"foo\" \"bar\"");
        assert_eq!(fts_quote("a\"b\"c"), "\"a\"\"b\"\"c\"");
        assert_eq!(fts_quote("ab cd"), "\"ab cd\"");
    }

    #[test]
    fn trigram_matches_chinese_substring() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        conn.execute("INSERT INTO sessions(path,agent_id,size,mtime,msg_count) VALUES('p','a',1,1,1)", []).unwrap();
        conn.execute("INSERT INTO fts(path,title,body) VALUES('p','','帮我构思一下单文件应用方案')", []).unwrap();
        let hits = search(&conn, &["a".into()], "单文件应用", 10).unwrap();
        assert_eq!(hits.len(), 1);
        let short = search(&conn, &["a".into()], "方案", 10).unwrap();
        assert_eq!(short.len(), 1);
        let none = search(&conn, &["b".into()], "单文件应用", 10).unwrap();
        assert!(none.is_empty());
    }
}
