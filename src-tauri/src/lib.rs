mod config;
mod guard;
mod index;
mod items;
mod model;
mod parsers;

use config::{Agent, Config, Paths};
use model::{SessionPage, SessionRow};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State, WindowEvent};

struct AppState {
    config: Mutex<Config>,
    warning: Mutex<Option<String>>,
    db: Mutex<Connection>,
    /// Last parsed session, so paging through a big file doesn't reparse it.
    cache: Mutex<Option<(String, i64, model::Parsed)>>,
}

type R<T> = Result<T, String>;

fn agent(st: &AppState, id: &str) -> R<Agent> {
    st.config.lock().unwrap().agents.iter().find(|a| a.id == id).cloned().ok_or_else(|| format!("未找到 agent：{id}"))
}

#[derive(Serialize)]
struct ConfigView {
    agents: Vec<Agent>,
    warning: Option<String>,
    config_path: String,
}

#[tauri::command]
fn get_config(st: State<AppState>) -> ConfigView {
    ConfigView {
        agents: st.config.lock().unwrap().agents.clone(),
        warning: st.warning.lock().unwrap().take(),
        config_path: guard::display(&config::config_path()),
    }
}

#[derive(Debug, Serialize)]
struct Detected {
    root: String,
    kind: String,
    name: String,
    paths: Paths,
}

fn folder_path(input: &str, home_dir: impl FnOnce() -> Option<PathBuf>) -> R<PathBuf> {
    let input = input.trim();
    if input.is_empty() {
        return Err("请输入文件夹路径".into());
    }
    if input.contains('\0') {
        return Err("文件夹路径无效".into());
    }
    if let Some(suffix) = input
        .strip_prefix("~/")
        .or_else(|| input.strip_prefix("~\\"))
        .or_else(|| (input == "~").then_some(""))
    {
        let relative = suffix.trim_start_matches(['/', '\\']).replace('\\', "/");
        let relative = Path::new(&relative);
        if matches!(relative.components().next(), Some(std::path::Component::Prefix(_))) {
            return Err("文件夹路径无效".into());
        }
        return Ok(home_dir().ok_or("无法确定用户主目录")?.join(relative));
    }
    let path = Path::new(input);
    if !path.is_absolute() {
        return Err("请输入绝对文件夹路径，或使用 ~ 表示用户主目录".into());
    }
    Ok(path.to_path_buf())
}

#[tauri::command]
fn detect_folder(root: String) -> R<Detected> {
    let requested = folder_path(&root, dirs::home_dir)?;
    match std::fs::metadata(&requested) {
        Ok(meta) if meta.is_dir() => {}
        Ok(_) => return Err("所选路径不是文件夹".into()),
        Err(e) if e.kind() == ErrorKind::NotFound => return Err("文件夹不存在".into()),
        Err(e) if e.kind() == ErrorKind::NotADirectory => return Err("所选路径不是文件夹".into()),
        Err(e) => return Err(format!("无法访问文件夹：{e}")),
    }
    let canonical = guard::canon(&requested).ok_or("无法解析文件夹路径")?;
    let kind = config::detect_kind(&canonical, &requested);
    let name = if kind == "generic" {
        requested
            .file_name()
            .map(|name| name.to_string_lossy().trim_start_matches('.').trim().to_string())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| config::default_name(kind).into())
    } else {
        config::default_name(kind).into()
    };
    Ok(Detected {
        root: guard::display(&canonical),
        kind: kind.into(),
        name,
        paths: config::default_paths(kind),
    })
}

#[tauri::command]
fn default_paths(kind: String) -> Paths {
    config::default_paths(&kind)
}

/// Count matched files per category for the given (unsaved) settings.
#[tauri::command]
async fn preview_paths(root: String, paths: Paths) -> HashMap<String, usize> {
    let probe = Agent { id: String::new(), name: String::new(), kind: "generic".into(), root, paths, enabled: true };
    ["sessions", "skills", "commands", "instructions"]
        .iter()
        .map(|k| (k.to_string(), guard::files(&probe, k).len()))
        .collect()
}

fn slug(name: &str, taken: &[String]) -> String {
    let base: String = name.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let base = base.trim_matches('-').to_string();
    let base = if base.is_empty() { "agent".to_string() } else { base };
    let mut id = base.clone();
    let mut n = 2;
    while taken.contains(&id) {
        id = format!("{base}-{n}");
        n += 1;
    }
    id
}

/// Add (empty id) or update an agent entry. Only omnia's own config is written.
#[tauri::command]
fn save_agent(st: State<AppState>, mut agent: Agent) -> R<Agent> {
    if !Path::new(&agent.root).is_dir() {
        return Err("根目录不存在".into());
    }
    agent.root = guard::display(&guard::canon(Path::new(&agent.root)).ok_or("无法解析根目录")?);
    agent.name = agent.name.trim().to_string();
    if agent.name.is_empty() {
        return Err("名称不能为空".into());
    }
    let mut cfg = st.config.lock().unwrap();
    let old = if agent.id.is_empty() {
        let taken: Vec<String> = cfg.agents.iter().map(|a| a.id.clone()).collect();
        agent.id = slug(&agent.name, &taken);
        cfg.agents.push(agent.clone());
        None
    } else {
        let slot = cfg.agents.iter_mut().find(|a| a.id == agent.id).ok_or("未找到 agent")?;
        Some(std::mem::replace(slot, agent.clone()))
    };
    config::save(&cfg)?;
    drop(cfg);
    // Paths/type changes invalidate this agent's index rows.
    if old.is_none_or(|o| o.root != agent.root || o.kind != agent.kind || o.paths != agent.paths) {
        index::forget(&st.db.lock().unwrap(), &agent.id)?;
    }
    Ok(agent)
}

/// Remove an agent from omnia's config. Never touches the folder on disk.
#[tauri::command]
fn remove_agent(st: State<AppState>, id: String) -> R<()> {
    let mut cfg = st.config.lock().unwrap();
    cfg.agents.retain(|a| a.id != id);
    config::save(&cfg)?;
    drop(cfg);
    index::forget(&st.db.lock().unwrap(), &id)
}

#[tauri::command]
fn reorder_agents(st: State<AppState>, ids: Vec<String>) -> R<()> {
    let mut cfg = st.config.lock().unwrap();
    cfg.agents.sort_by_key(|a| ids.iter().position(|i| i == &a.id).unwrap_or(usize::MAX));
    config::save(&cfg)
}

#[tauri::command]
async fn refresh(st: State<'_, AppState>, ids: Vec<String>) -> R<HashMap<String, index::Stats>> {
    let agents: Vec<Agent> = st.config.lock().unwrap().agents.iter().filter(|a| ids.contains(&a.id)).cloned().collect();
    let mut out = HashMap::new();
    for a in agents {
        let stats = index::refresh(&mut st.db.lock().unwrap(), &a)?;
        out.insert(a.id.clone(), stats);
    }
    Ok(out)
}

#[tauri::command]
async fn list_sessions(
    st: State<'_, AppState>,
    ids: Vec<String>,
    query: String,
    project: Option<String>,
    limit: Option<i64>,
) -> R<Vec<SessionRow>> {
    let project = project.filter(|p| !p.is_empty());
    index::search(&st.db.lock().unwrap(), &ids, &query, project.as_deref(), limit.unwrap_or(500))
}

/// Working folders the sessions in scope were started in.
#[tauri::command]
async fn list_projects(st: State<'_, AppState>, ids: Vec<String>) -> R<Vec<index::Project>> {
    index::projects(&st.db.lock().unwrap(), &ids)
}

#[tauri::command]
async fn read_session(st: State<'_, AppState>, agent_id: String, path: String, offset: usize, limit: usize) -> R<SessionPage> {
    let a = agent(&st, &agent_id)?;
    let p = guard::check(&a, "sessions", &path)?;
    let key = guard::display(&p);
    let mtime = std::fs::metadata(&p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let mut cache = st.cache.lock().unwrap();
    let hit = matches!(&*cache, Some((k, m, _)) if *k == key && *m == mtime);
    if !hit {
        *cache = Some((key, mtime, parsers::parse_file(&a.kind, &p)?));
    }
    let parsed = &cache.as_ref().unwrap().2;
    let end = (offset + limit).min(parsed.msgs.len());
    Ok(SessionPage {
        meta: parsed.meta.clone(),
        total: parsed.msgs.len(),
        offset,
        msgs: parsed.msgs.get(offset.min(end)..end).unwrap_or(&[]).to_vec(),
    })
}

#[tauri::command]
async fn list_items(st: State<'_, AppState>, agent_id: String, kind: String) -> R<Vec<model::Item>> {
    if !["skills", "commands", "instructions"].contains(&kind.as_str()) {
        return Err("未知类别".into());
    }
    Ok(items::list(&agent(&st, &agent_id)?, &kind))
}

#[tauri::command]
async fn read_item(st: State<'_, AppState>, agent_id: String, kind: String, path: String) -> R<String> {
    let a = agent(&st, &agent_id)?;
    items::read_text(&guard::check(&a, &kind, &path)?)
}

/// Show a file in Explorer (read-only action). Path must belong to the agent.
#[tauri::command]
fn reveal(st: State<AppState>, agent_id: String, kind: String, path: String) -> R<()> {
    let a = agent(&st, &agent_id)?;
    let p = guard::check(&a, &kind, &path)?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer").arg(format!("/select,{}", p.display())).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = p;
    }
    Ok(())
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn run() {
    let (cfg, warning) = config::load();
    let db = index::open(&config::omnia_dir().join("index.db")).expect("无法打开索引数据库");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState { config: Mutex::new(cfg), warning: Mutex::new(warning), db: Mutex::new(db), cache: Mutex::new(None) })
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "打开 Omnia", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("missing icon"))
                .tooltip("Omnia")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } = e {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|w, e| {
            // Closing the window hides it to the tray; quit from the tray menu.
            if let WindowEvent::CloseRequested { api, .. } = e {
                api.prevent_close();
                let _ = w.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            detect_folder,
            default_paths,
            preview_paths,
            save_agent,
            remove_agent,
            reorder_agents,
            refresh,
            list_sessions,
            list_projects,
            read_session,
            list_items,
            read_item,
            reveal
        ])
        .run(tauri::generate_context!())
        .expect("error while running omnia");
}

#[cfg(test)]
mod folder_tests {
    use super::*;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!("omnia-detect-{}-{stamp}", std::process::id()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn expands_home_and_rejects_invalid_input() {
        let home = std::env::temp_dir();
        assert_eq!(folder_path(" ~ ", || Some(home.clone())).unwrap(), home);
        for input in [" ~/.codex/sessions ", r" ~\.codex\sessions "] {
            assert_eq!(
                folder_path(input, || Some(home.clone())).unwrap(),
                home.join(".codex/sessions")
            );
        }
        assert!(folder_path("~", || None).is_err());
        for input in [" ", ".codex", "~other/.codex", "\0"] {
            assert!(folder_path(input, || Some(home.clone())).is_err());
        }
    }

    #[test]
    fn detects_fresh_folders_and_prefers_signatures() {
        let tmp = TestDir::new();
        for kind in ["claude", "codex", "gemini"] {
            let root = tmp.0.join(format!(".{kind}"));
            std::fs::create_dir(&root).unwrap();
            let detected = detect_folder(format!("  {}  ", root.display())).unwrap();
            assert_eq!(detected.kind, kind);
            assert_eq!(detected.name, config::default_name(kind));
            assert_eq!(detected.paths, config::default_paths(kind));
            assert_eq!(detected.root, guard::display(&guard::canon(&root).unwrap()));
        }
        let root = tmp.0.join(".claude");
        std::fs::write(root.join("config.toml"), "").unwrap();
        std::fs::create_dir(root.join("sessions")).unwrap();
        assert_eq!(detect_folder(root.to_str().unwrap().into()).unwrap().kind, "codex");
    }

    #[test]
    fn names_generic_folders_and_distinguishes_path_errors() {
        let tmp = TestDir::new();
        let generic = tmp.0.join(".custom");
        std::fs::create_dir(&generic).unwrap();
        let detected = detect_folder(generic.to_str().unwrap().into()).unwrap();
        assert_eq!(detected.kind, "generic");
        assert_eq!(detected.name, "custom");

        let file = tmp.0.join("file");
        std::fs::write(&file, "").unwrap();
        assert_eq!(detect_folder(file.to_str().unwrap().into()).unwrap_err(), "所选路径不是文件夹");
        let missing = tmp.0.join("missing");
        assert_eq!(detect_folder(missing.to_str().unwrap().into()).unwrap_err(), "文件夹不存在");
    }

    #[cfg(unix)]
    #[test]
    fn detects_symlink_from_requested_name_and_returns_resolved_path() {
        let tmp = TestDir::new();
        let target = tmp.0.join("...");
        std::fs::create_dir(&target).unwrap();
        assert_eq!(detect_folder(target.to_str().unwrap().into()).unwrap().name, "Agent");
        let alias = tmp.0.join(".gemini");
        std::os::unix::fs::symlink(&target, &alias).unwrap();
        let detected = detect_folder(alias.to_str().unwrap().into()).unwrap();
        assert_eq!(detected.kind, "gemini");
        assert_eq!(detected.root, guard::display(&guard::canon(&target).unwrap()));
    }
}

#[cfg(test)]
mod real_data {
    //! `cargo test -- --ignored --nocapture` : parse every local session.
    use super::*;

    #[test]
    #[ignore]
    fn parse_all_local_sessions() {
        let home = dirs::home_dir().unwrap();
        for kind in ["claude", "codex", "gemini"] {
            let a = Agent {
                id: kind.into(),
                name: kind.into(),
                kind: kind.into(),
                root: guard::display(&home.join(format!(".{kind}"))),
                paths: config::default_paths(kind),
                enabled: true,
            };
            let files = guard::files(&a, "sessions");
            let (mut ok, mut empty, mut titled, mut msgs, mut raw) = (0, 0, 0, 0, 0);
            for f in &files {
                let p = parsers::parse_file(kind, f).expect("parse");
                ok += 1;
                if p.msgs.iter().all(|m| m.kind != "text") {
                    empty += 1;
                }
                if p.meta.title.is_some() {
                    titled += 1;
                }
                msgs += p.msgs.len();
                raw += p.msgs.iter().filter(|m| m.kind == "raw").count();
            }
            let skills = items::list(&a, "skills").len();
            let instr = items::list(&a, "instructions").len();
            println!("{kind}: files={} parsed={ok} no_text={empty} titled={titled} msgs={msgs} raw={raw} skills={skills} instructions={instr}", files.len());
            // credentials never matched even by a catch-all glob
            let mut all = a.clone();
            all.paths.sessions = vec!["**/*".into()];
            assert!(guard::files(&all, "sessions").iter().all(|p| !guard::is_denied(p)));
            assert!(guard::check(&a, "sessions", &guard::display(&home.join(format!(".{kind}/auth.json")))).is_err());
        }
    }
}
