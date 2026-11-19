import { Fragment, memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Agent, Msg, SessionPage, SessionRow, api, errText, fmtClock, fmtRange, fmtSize, fmtTime, resumeCommand, shortPath } from "./api";
import { groupMsgs } from "./conversation";
import { Markdown } from "./md";
import { AgentIcon, IconChevron, IconCopy, IconEye, IconEyeOff, IconFolder, IconInfo, IconTool, IconUser, TINT } from "./icons";
import type { ModelDisplay } from "./prefs";

interface ReadingOptions {
  showMetaDefault: boolean;
  expandDefault: boolean;
  modelDisplay: ModelDisplay;
  collapseLongMessages: boolean;
}

const PAGE = 200;

/** Day bucket label for grouping the list: 今天 / 昨天 / 2026-11-12. */
function dayLabel(v: string | number | null): string {
  if (!v) return "未知日期";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "未知日期";
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (day(now) - day(d)) / 86400000;
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function Sessions({
  agents,
  version,
  toast,
  query,
  project,
  onCount,
  ...reading
}: ReadingOptions & {
  agents: Agent[];
  version: number;
  toast: (s: string) => void;
  query: string;
  /** Folder filter from the sidebar; null means every project. */
  project: string | null;
  onCount: (n: number) => void;
}) {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [sel, setSel] = useState<SessionRow | null>(null);
  // Start in the loading state: on the very first render there are no rows yet,
  // and reporting that empty array as a real count produces the 0 flash.
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const ids = agents.map((a) => a.id).join(",");
  const scopeKey = `${ids}|${project ?? ""}`;
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  const multi = agents.length > 1;

  // Scope changes must be applied during render, not in an effect: an effect runs
  // *after* the first render with the new agents, when `sel` still points at the
  // previous agent. `byId[sel.agent_id]` is then undefined, SessionView reads
  // `agent.type` and React unmounts the whole tree (the "everything goes grey" bug).
  const [scope, setScope] = useState(scopeKey);
  if (scope !== scopeKey) {
    setScope(scopeKey);
    setRows([]);
    setSel(null);
    setLoading(true);
    setReady(false);
  }

  // Derive a valid selection instead of trusting stale state. The detail pane can
  // therefore never receive an agent that is no longer in scope.
  const selAgent = sel ? agents.find((a) => a.id === sel.agent_id) : undefined;
  const active = sel && selAgent ? sel : null;

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      setLoading(true);
      api
        .listSessions(ids ? ids.split(",") : [], query, project)
        .then((r) => {
          if (!live) return;
          setRows(r);
          setReady(true);
        })
        .catch((e) => toast(errText(e)))
        .finally(() => live && setLoading(false));
    }, 180);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [ids, project, query, version]);

  // A failed fetch keeps the last valid count instead of dropping it to 0.
  useEffect(() => {
    if (ready && !loading) onCount(rows.length);
  }, [rows.length, loading, ready]);

  // Land on something readable instead of an empty pane — but only on a row that
  // belongs to the current scope.
  useEffect(() => {
    if (active || !rows.length) return;
    const first = rows.find((r) => byId[r.agent_id]);
    if (first) setSel(first);
  }, [rows, active, scopeKey]);

  const groups = useMemo(() => {
    const out: { label: string; rows: SessionRow[] }[] = [];
    for (const r of rows) {
      const label = dayLabel(r.updated || r.mtime);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(r);
      else out.push({ label, rows: [r] });
    }
    return out;
  }, [rows]);

  return (
    <div className="split">
      <div className="list">
        <div className="listscroll">
          {groups.map((g) => (
            <Fragment key={g.label}>
              <div className="daylab">
                {g.label}
                <b>{g.rows.length} 条</b>
              </div>
              {g.rows.map((r) => {
                const a = byId[r.agent_id];
                const title = r.title || r.session_id || "（无标题）";
                return (
                  <button key={r.path} className={`row ${active?.path === r.path ? "on" : ""}`} onClick={() => setSel(r)}>
                    <div className="rt">{title}</div>
                    {r.snippet && <div className="rs">{highlight(r.snippet)}</div>}
                    <div className="rm">
                      <span className="dot" style={{ ["--c" as string]: TINT[a?.type ?? "generic"] }} />
                      <span
                        className="who"
                        style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {multi ? a?.name : shortPath(r.cwd) || a?.name}
                      </span>
                      <span className="sp" />
                      <span>{fmtSize(r.size)}</span>
                      <span>·</span>
                      <span>{fmtClock(r.updated || r.mtime)}</span>
                    </div>
                  </button>
                );
              })}
            </Fragment>
          ))}
          {!loading && rows.length === 0 && (
            <div className="empty">
              {query ? "没有匹配的会话" : project ? "这个项目下还没有会话" : "没有会话。检查该 agent 的会话路径设置。"}
            </div>
          )}
        </div>
      </div>

      <section className="detail">
        {active && selAgent ? (
          <SessionView
            key={active.path}
            row={active}
            agent={selAgent}
            toast={toast}
            {...reading}
          />
        ) : (
          <div className="empty" style={{ margin: "auto" }}>
            {loading ? "加载中…" : "从左侧选择一个会话"}
          </div>
        )}
      </section>
    </div>
  );
}

function highlight(s: string) {
  return s.split(/(«[^»]*»)/g).map((part, i) =>
    part.startsWith("«") ? <mark key={i}>{part.slice(1, -1)}</mark> : <span key={i}>{part}</span>,
  );
}

const STEP_LABEL: Record<string, string> = {
  tool_call: "工具调用",
  tool_result: "结果",
  thinking: "思考",
  raw: "原始数据",
  meta: "系统注入",
};

function SessionView({
  row,
  agent,
  toast,
  showMetaDefault,
  expandDefault,
  modelDisplay,
  collapseLongMessages,
}: ReadingOptions & {
  row: SessionRow;
  agent: Agent;
  toast: (s: string) => void;
}) {
  const [page, setPage] = useState<SessionPage | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showMeta, setShowMeta] = useState(showMetaDefault);
  const [expandAll, setExpandAll] = useState(expandDefault);
  // A process segment is hidden unless it is opened. `allProcess` flips the
  // default; `overrides` holds the segments the user toggled away from it.
  const [allProcess, setAllProcess] = useState(false);
  const [overrides, setOverrides] = useState<Set<number>>(() => new Set());
  const busy = useRef(false);
  const blocks = useMemo(() => groupMsgs(msgs, showMeta), [msgs, showMeta]);
  const processCount = useMemo(
    () => blocks.reduce((n, b) => n + b.parts.filter((p) => p.kind !== "text" && p.kind !== "meta").length, 0),
    [blocks],
  );

  // Settings changes should reach a view that is already mounted.
  useEffect(() => setShowMeta(showMetaDefault), [showMetaDefault]);
  useEffect(() => setExpandAll(expandDefault), [expandDefault]);

  const load = (offset: number) => {
    if (busy.current || !agent) return;
    busy.current = true;
    api
      .readSession(agent.id, row.path, offset, PAGE)
      .then((p) => {
        setPage(p);
        setMsgs((m) => (offset === 0 ? p.msgs : [...m, ...p.msgs]));
      })
      .catch((e) => setErr(errText(e)))
      .finally(() => (busy.current = false));
  };
  useEffect(() => load(0), []);

  const copy = (text: string, what: string) => writeText(text).then(() => toast(`已复制${what}`), (e) => toast(errText(e)));

  if (err) return <div className="empty error">{err}</div>;
  if (!page) return <div className="empty">加载中…</div>;

  const m = page.meta;
  const resume = resumeCommand(agent.type, m.session_id, m.cwd);
  const isOpen = (id: number) => (allProcess ? !overrides.has(id) : overrides.has(id));
  const toggleSeg = (id: number) =>
    setOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => {
    setAllProcess((v) => !v);
    setOverrides(new Set());
  };

  return (
    <>
      <div className="dhead">
        <div className="dtitle">{m.title || m.session_id || "（无标题）"}</div>
        <div className="dmeta">
          {m.cwd && (
            <span className="mi">
              <IconFolder />
              <code>{m.cwd}</code>
            </span>
          )}
          {modelDisplay !== "hidden" && m.model && (
            <span className="mi session-model">
              <span>最近记录模型</span>
              <ModelBadge model={m.model} />
            </span>
          )}
          {(m.started || m.updated) && <span>{fmtRange(m.started, m.updated)}</span>}
          <span>
            {fmtSize(row.size)} · {page.total} 条
          </span>
        </div>
        <div className="dacts">
          {resume && (
            <button className="btn p" onClick={() => copy(resume, "恢复命令")} title="复制恢复该会话的命令">
              <IconCopy />
              恢复命令
            </button>
          )}
          {m.session_id && (
            <button className="btn" onClick={() => copy(m.session_id!, "会话 ID")}>
              复制 ID
            </button>
          )}
          <button className="btn" onClick={() => copy(toMarkdown(m.title, msgs), " Markdown")}>
            复制 Markdown
          </button>
          <button className="btn" onClick={() => api.reveal(agent.id, "sessions", row.path).catch((e) => toast(errText(e)))}>
            打开位置
          </button>
          <div className="dacts-right">
            <button
              className={`btn eye ${allProcess ? "on" : ""}`}
              onClick={toggleAll}
              disabled={processCount === 0}
              title={allProcess ? "隐藏所有过程步骤" : "展开所有过程步骤"}
            >
              {allProcess ? <IconEyeOff /> : <IconEye />}
              {allProcess ? "隐藏过程" : "显示过程"}
              {processCount > 0 && <span className="pcount">{processCount}</span>}
            </button>
            <label className="tog">
              <input type="checkbox" checked={showMeta} onChange={(e) => setShowMeta(e.target.checked)} />
              <span className="sw" />
              系统注入
            </label>
            <label className="tog">
              <input type="checkbox" checked={expandAll} onChange={(e) => setExpandAll(e.target.checked)} />
              <span className="sw" />
              展开步骤
            </label>
          </div>
        </div>
      </div>

      <div className="chat">
        <div className="chatstart">
          <span>{m.started ? `会话开始 · ${fmtTime(m.started)}` : "会话开始"}</span>
        </div>

        {blocks.map((b) => {
          if (b.role === "system") return <SystemRow key={b.id} m={b.parts[0]} />;
          const user = b.role === "user";
          const bubbleRole: "user" | "assistant" = user ? "user" : "assistant";
          const stamp = b.parts.find((p) => p.ts)?.ts;
          const hasText = b.segs.some((s) => s.kind === "text");
          return (
            <div className={`msg ${user ? "user" : "agent"}`} key={b.id}>
              <div className={`mav ${user ? "u" : "a"}`} style={user ? undefined : { ["--c" as string]: TINT[agent.type] }}>
                {user ? <IconUser /> : <AgentIcon kind={agent.type} className="agi" />}
              </div>
              <div className="mstack">
                <div className="mhead">
                  <span className="mname">{user ? "你" : agent.name}</span>
                  {stamp && <span className="mtime">{fmtTime(stamp)}</span>}
                  {modelDisplay === "all" && b.model && <ModelBadge model={b.model} />}
                  {hasText && (
                    <button
                      className="mcopy"
                      title="复制这条消息"
                      aria-label="复制这条消息"
                      onClick={() => copy(b.parts.filter((p) => p.kind === "text").map((p) => p.text).join("\n\n"), "消息")}
                    >
                      <IconCopy />
                    </button>
                  )}
                </div>
                {b.segs.map((s) =>
                  s.kind === "text" ? (
                    <Bubble key={s.id} role={bubbleRole} parts={s.parts} collapseLong={collapseLongMessages} />
                  ) : (
                    <Process
                      key={s.id}
                      parts={s.parts}
                      open={isOpen(s.id)}
                      onToggle={() => toggleSeg(s.id)}
                      expandAll={expandAll}
                    />
                  ),
                )}
              </div>
            </div>
          );
        })}

        {msgs.length < page.total && (
          <button className="btn more" onClick={() => load(msgs.length)}>
            加载更多（{msgs.length}/{page.total}）
          </button>
        )}
      </div>
    </>
  );
}

function ModelBadge({ model }: { model: string }) {
  return <span className="mchip" title={model}>{model}</span>;
}

const PREVIEW_HEIGHT = 268;

/** Measure the rendered content, so short Markdown with tables/code and narrow layouts fold correctly. */
const Bubble = memo(function Bubble({ role, parts, collapseLong }: {
  role: "user" | "assistant";
  parts: Msg[];
  collapseLong: boolean;
}) {
  const [full, setFull] = useState(false);
  const [tall, setTall] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const el = content.current;
    if (!el || !collapseLong) return;
    const measure = () => setTall(el.scrollHeight > PREVIEW_HEIGHT);
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(el);
    return () => observer.disconnect();
  }, [collapseLong]);

  const collapsible = collapseLong && tall;
  const clamped = collapsible && !full;
  return (
    <>
      <div
        id={id}
        className={`bubble ${role} ${clamped ? "clamp" : ""}`}
        style={clamped ? { maxHeight: PREVIEW_HEIGHT } : undefined}
      >
        <div className="bubble-content" ref={content} inert={clamped || undefined}>
          {role === "user"
            ? parts.map((p, i) => <div className="utext" key={i}>{p.text}</div>)
            : parts.map((p, i) => <Markdown key={i} text={p.text} />)}
        </div>
      </div>
      {collapsible && (
        <button
          className={`fullbtn ${full ? "up" : ""}`}
          aria-expanded={full}
          aria-controls={id}
          onClick={() => setFull((v) => !v)}
        >
          {full ? "收起" : "展开全文"}
          <IconChevron />
        </button>
      )}
    </>
  );
});

/** Hidden-by-default process trace (thinking / tool calls / results). */
function Process({
  parts,
  open,
  onToggle,
  expandAll,
}: {
  parts: Msg[];
  open: boolean;
  onToggle: () => void;
  expandAll: boolean;
}) {
  const tags = Object.entries(
    parts.reduce<Record<string, number>>((acc, p) => {
      const k = STEP_LABEL[p.kind] ?? "其他";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
  );
  return (
    <div className={`proc ${open ? "open" : ""}`}>
      <button className="pbtn" onClick={onToggle} aria-expanded={open}>
        <span className="pi">
          <IconTool />
        </span>
        <b>{parts.length} 个过程步骤</b>
        <span className="ptags">
          {tags.map(([k, n]) => (
            <span key={k}>
              {k} {n}
            </span>
          ))}
        </span>
        <span className="pcv">
          <IconChevron />
        </span>
      </button>
      {open && (
        <div className="pbody">
          {parts.map((p, j) => (
            <StepRow key={j} m={p} open={expandAll} />
          ))}
        </div>
      )}
    </div>
  );
}

function StepRow({ m, open }: { m: Msg; open: boolean }) {
  const [expanded, setExpanded] = useState(open || m.kind === "raw");
  useEffect(() => setExpanded(open || m.kind === "raw"), [open, m.kind]);
  const label = m.kind === "tool_call" ? m.name || STEP_LABEL[m.kind] : STEP_LABEL[m.kind] ?? "步骤";
  const cls = m.kind === "thinking" ? "think" : m.kind === "tool_result" ? "res" : m.kind === "raw" ? "raw" : "";
  const preview = m.text.replace(/\s+/g, " ").trim().slice(0, 130);
  return (
    <div className={`srow ${cls}`}>
      <button className="srow-h" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <span className={`ic ${m.kind === "tool_call" ? "tool" : m.kind === "tool_result" ? "res" : m.kind === "raw" ? "raw" : ""}`} />
        <span className="nm">{label}</span>
        <span className="ar">{preview}</span>
        <span className="cv">
          <IconChevron />
        </span>
      </button>
      {expanded && <pre>{m.text}</pre>}
    </div>
  );
}

/** System-injected context sits between messages, not inside an agent reply. */
function SystemRow({ m }: { m: Msg }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sysmsg">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <IconInfo />
        系统注入{m.name ? ` · ${m.name}` : ""}
        <span>{open ? "收起" : "查看内容"}</span>
      </button>
      {open && <pre>{m.text}</pre>}
    </div>
  );
}

function toMarkdown(title: string | null, msgs: Msg[]) {
  const out = [`# ${title ?? "会话"}`, ""];
  for (const m of msgs) {
    if (m.kind === "text") out.push(`## ${m.role === "user" ? "User" : "Assistant"}`, "", m.text, "");
    else if (m.kind === "tool_call") out.push(`> 🔧 ${m.name ?? "tool"}`, "", "```", m.text, "```", "");
  }
  return out.join("\n");
}
