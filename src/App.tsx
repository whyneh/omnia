import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Agent, Category, Project, api, errText, projectName, shortPath } from "./api";
import { Sessions } from "./Sessions";
import { Items } from "./Items";
import { AgentForm } from "./AgentForm";
import { Settings } from "./Settings";
import {
  AgentIcon,
  IconAll,
  IconChat,
  IconCommand,
  IconDoc,
  IconFolder,
  IconGear,
  IconPlus,
  IconSkill,
  KIND_LABEL,
} from "./icons";
import { TitleBar } from "./TitleBar";
import { Prefs, loadPrefs, loadScope, savePrefs, saveScope } from "./prefs";

const TABS: { key: Category; label: string; icon: () => ReactElement }[] = [
  { key: "sessions", label: "会话", icon: IconChat },
  { key: "skills", label: "Skill", icon: IconSkill },
  { key: "commands", label: "命令", icon: IconCommand },
  { key: "instructions", label: "指令", icon: IconDoc },
];

const PLACEHOLDER: Record<Category, string> = {
  sessions: "搜索会话内容",
  skills: "按名称、描述过滤",
  commands: "按名称、描述过滤",
  instructions: "按名称、描述过滤",
};

const ALL = "__all__";

const num = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString("en-US"));

export default function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [current, setCurrent] = useState<string>(ALL);
  const [project, setProject] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tab, setTab] = useState<Category>(() => loadPrefs().startTab);
  const [editing, setEditing] = useState<Agent | null | "new">(null);
  const [version, setVersion] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState<Partial<Record<Category, number>>>({});
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configPath, setConfigPath] = useState("");
  const timer = useRef<number>(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => savePrefs(prefs), [prefs]);

  const toast = useCallback((s: string) => {
    setMsg(s);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2600);
  }, []);

  const sync = useCallback(
    async (list: Agent[], quiet = false) => {
      const ids = list.filter((a) => a.enabled).map((a) => a.id);
      if (!ids.length) return;
      setSyncing(true);
      try {
        const stats = await api.refresh(ids);
        const changed = Object.values(stats).reduce((n, s) => n + s.updated + s.removed, 0);
        const failed = Object.values(stats).reduce((n, s) => n + s.failed, 0);
        if (!quiet || failed) toast(`索引已更新：${changed} 个变化${failed ? `，${failed} 个文件解析失败` : ""}`);
      } catch (e) {
        toast(errText(e));
      } finally {
        setSyncing(false);
        setVersion((v) => v + 1);
      }
    },
    [toast],
  );

  useEffect(() => {
    api.getConfig().then((c) => {
      setAgents(c.agents);
      setConfigPath(c.config_path);
      if (c.warning) toast(c.warning);
      const saved = loadScope();
      if (loadPrefs().rememberScope && saved && c.agents.some((a) => a.id === saved)) setCurrent(saved);
      sync(c.agents, true);
    });
  }, []);

  // Optionally re-sync when the window regains focus (sessions may have grown).
  useEffect(() => {
    if (!prefs.autoIndexOnFocus) return;
    const onFocus = () => !syncing && sync(agents, true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [agents, syncing, sync, prefs.autoIndexOnFocus]);

  useEffect(() => {
    if (prefs.rememberScope) saveScope(current);
  }, [current, prefs.rememberScope]);

  // Ctrl/Cmd+K focuses the search field; Esc clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (e.key === "Escape" && document.activeElement === searchRef.current) {
        setQuery("");
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Tab changes clear the query in the same render as the tab switch (one
  // update, not a follow-up effect that triggers a second fetch). Scope changes
  // can still happen from several places, so they reset the query here.
  useEffect(() => setQuery(""), [current]);

  const pickTab = (k: Category) => {
    if (k === tab) return;
    setTab(k);
    setQuery("");
  };

  const enabled = agents.filter((a) => a.enabled);
  const scope = current === ALL ? enabled : agents.filter((a) => a.id === current);

  // Projects are session cwds, so they follow the agent scope and the index.
  const idsKey = scope.map((a) => a.id).join(",");
  useEffect(() => {
    if (!idsKey) {
      setProjects([]);
      setProject(null);
      return;
    }
    let live = true;
    api
      .listProjects(idsKey.split(","))
      .then((list) => {
        if (!live) return;
        setProjects(list);
        // Drop a filter that no longer matches anything in scope.
        setProject((p) => (p && !list.some((x) => x.path === p) ? null : p));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [idsKey, version]);

  // The same folder name in two places (…/omnia and …/omnia-old) needs its
  // parent segment to stay distinguishable.
  const named = useMemo(() => {
    const seen = new Map<string, number>();
    for (const p of projects) {
      const k = projectName(p.path).toLowerCase();
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return projects.map((p) => ({
      ...p,
      name: (seen.get(projectName(p.path).toLowerCase()) ?? 1) > 1 ? shortPath(p.path) : projectName(p.path),
    }));
  }, [projects]);

  const pickProject = (path: string | null) => {
    setProject(path);
    if (path && tab !== "sessions") pickTab("sessions");
  };

  const report = useCallback(
    (k: Category, n: number) => setCounts((c) => (c[k] === n ? c : { ...c, [k]: n })),
    [],
  );

  const onSaved = (a: Agent) => {
    const next = agents.some((x) => x.id === a.id) ? agents.map((x) => (x.id === a.id ? a : x)) : [...agents, a];
    setAgents(next);
    setEditing(null);
    setCurrent(a.id);
    sync([a]);
  };

  const onRemove = async (a: Agent) => {
    await api.removeAgent(a.id);
    setAgents((list) => list.filter((x) => x.id !== a.id));
    setEditing(null);
    setCurrent(ALL);
    setVersion((v) => v + 1);
    toast(`已移除 ${a.name}（磁盘文件未改动）`);
  };

  const viewStyle = (k: Category) => ({ display: tab === k ? "flex" : "none" });
  // Only the active view follows the live query. A hidden view stays on an empty
  // query, so typing in another category never starts a background session
  // search; and since pickTab clears the query, both views see an unchanged
  // query on a tab switch, making the switch a pure CSS visibility change.
  const viewQuery = (k: Category) => (tab === k ? query : "");
  const body = (
    <>
      {agents.length === 0 && (
        <div className="empty">
          还没有 agent。
          <button onClick={() => setEditing("new")}>添加一个</button>
        </div>
      )}

      {agents.length > 0 && (
        <div className="view" style={viewStyle("sessions")}>
          <Sessions
            agents={scope}
            version={version}
            toast={toast}
            query={viewQuery("sessions")}
            project={project}
            onCount={(n) => report("sessions", n)}
            showMetaDefault={prefs.showMeta}
            expandDefault={prefs.expandTools}
            modelDisplay={prefs.modelDisplay}
            collapseLongMessages={prefs.collapseLongMessages}
          />
        </div>
      )}

      {agents.length > 0 && (
        <div className="view" style={viewStyle("skills")}>
          <Items agents={scope} kind="skills" version={version} toast={toast} query={viewQuery("skills")} onCount={(n) => report("skills", n)} />
        </div>
      )}

      {agents.length > 0 && (
        <div className="view" style={viewStyle("commands")}>
          <Items agents={scope} kind="commands" version={version} toast={toast} query={viewQuery("commands")} onCount={(n) => report("commands", n)} />
        </div>
      )}

      {agents.length > 0 && (
        <div className="view" style={viewStyle("instructions")}>
          <Items agents={scope} kind="instructions" version={version} toast={toast} query={viewQuery("instructions")} onCount={(n) => report("instructions", n)} />
        </div>
      )}
    </>
  );

  return (
    <div className="shell">
      <TitleBar
        query={query}
        onQuery={setQuery}
        searchRef={searchRef}
        placeholder={PLACEHOLDER[tab]}
        syncing={syncing}
        onSync={() => sync(agents)}
      />

      <div className="app">
        <aside className="side">
          <nav className="cats">
            {TABS.map((t) => (
              <button
                key={t.key}
                data-cat={t.key}
                className={`cat ${tab === t.key ? "on" : ""}`}
                onClick={() => pickTab(t.key)}
              >
                <span className="ci">
                  <t.icon />
                </span>
                <span className="nm">{t.label}</span>
                <span className="n">{counts[t.key] === undefined ? "" : num(counts[t.key]!)}</span>
              </button>
            ))}
          </nav>

          <div className="sect">项目</div>
          <div className="projs">
            <button className={`pj ${project ? "" : "on"}`} onClick={() => pickProject(null)}>
              <span className="pi">
                <IconAll />
              </span>
              <span className="nm">全部项目</span>
            </button>
            {named.map((p) => (
              <button
                key={p.path}
                className={`pj ${project === p.path ? "on" : ""}`}
                onClick={() => pickProject(p.path)}
                title={p.path}
              >
                <span className="pi">
                  <IconFolder />
                </span>
                <span className="nm">{p.name}</span>
                <span className="n">{num(p.sessions)}</span>
              </button>
            ))}
            {!named.length && <div className="pj-empty">还没有会话项目</div>}
          </div>

          <div className="grow" />

          <div className="sfoot">
            <button data-settings-toggle className={settingsOpen ? "on" : ""} onClick={() => setSettingsOpen(true)}>
              <IconGear />
              设置
            </button>
          </div>
        </aside>

        <main className="main">
          {/* Its own row, right-aligned: which agent is in scope is one glance
              away and switching costs a single click. */}
          <div className="topbar">
            <div className="chips">
              <button
                data-agent="all"
                className={`chip ${current === ALL ? "on" : ""}`}
                onClick={() => setCurrent(ALL)}
                title={enabled.map((a) => a.name).join(" · ")}
              >
                <span className="ico">
                  <IconAll />
                </span>
                全部
              </button>
              {agents.map((a) => (
                <div key={a.id} className={`chip-source ${current === a.id ? "on" : ""}`}>
                  <button
                    data-agent={a.id}
                    className={`chip ${current === a.id ? "on" : ""} ${a.enabled ? "" : "off"}`}
                    onClick={() => setCurrent(a.id)}
                    title={`${KIND_LABEL[a.type]} · ${a.root}`}
                  >
                    <AgentIcon kind={a.type} className="ico" />
                    {a.name}
                  </button>
                  {current === a.id && (
                    <button className="chip-gear" title={`编辑 ${a.name} 的数据目录`} aria-label={`编辑 ${a.name} 的数据目录`} onClick={() => setEditing(a)}>
                      <IconGear />
                    </button>
                  )}
                </div>
              ))}
              <button className="chip add" data-add-agent title="添加 Agent 数据目录" aria-label="添加 Agent 数据目录" onClick={() => setEditing("new")}>
                <IconPlus />
              </button>
            </div>
          </div>

          {body}
        </main>
      </div>

      {settingsOpen && (
        <Settings prefs={prefs} onPrefs={setPrefs} configPath={configPath} onClose={() => setSettingsOpen(false)} />
      )}

      {editing && (
        <AgentForm
          initial={editing === "new" ? null : editing}
          agents={agents}
          onSaved={onSaved}
          onRemove={onRemove}
          onClose={() => setEditing(null)}
        />
      )}

      {msg && <div className="toast">{msg}</div>}
    </div>
  );
}
