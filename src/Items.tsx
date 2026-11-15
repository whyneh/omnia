import { useEffect, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Agent, Item, api, errText, fmtSize, fmtTime } from "./api";
import { Doc } from "./md";
import { IconCopy, IconFolder, TINT } from "./icons";

type ItemKind = "skills" | "commands" | "instructions";
interface Row extends Item {
  agent: Agent;
}

const EMPTY: Record<ItemKind, string> = {
  skills: "没有 skill。检查该 agent 的 skill 路径设置。",
  commands: "没有自定义命令（本机这几个 agent 目前都没有命令目录）。",
  instructions: "没有全局指令文件。",
};

export function Items({
  agents,
  kind,
  version,
  toast,
  query,
  onCount,
}: {
  agents: Agent[];
  kind: ItemKind;
  version: number;
  toast: (s: string) => void;
  query: string;
  onCount: (n: number) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<Row | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const multi = agents.length > 1;
  const scopeKey = `${agents.map((a) => a.id).join(",")}|${kind}`;
  // `version` only signals "the index may have changed": re-fetch without
  // clearing the list, so a background sync cannot blank it out.
  const key = `${scopeKey}|${version}`;

  // Reset during render, before the auto-select effect can latch onto a row from
  // the previous scope and leave the detail pane showing another agent's file.
  const [scope, setScope] = useState(scopeKey);
  if (scope !== scopeKey) {
    setScope(scopeKey);
    setRows([]);
    setSel(null);
    setText(null);
    setLoading(true);
    setReady(false);
  }

  useEffect(() => {
    let live = true;
    Promise.all(agents.map((a) => api.listItems(a.id, kind).then((items) => items.map((i) => ({ ...i, agent: a })))))
      .then((all) => {
        if (!live) return;
        setRows(all.flat());
        setReady(true);
      })
      .catch((e) => toast(errText(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [key]);

  useEffect(() => {
    if (!sel) return;
    setText(null);
    api.readItem(sel.agent.id, kind, sel.path).then(setText, (e) => setText(`读取失败：${errText(e)}`));
  }, [sel?.path]);

  useEffect(() => {
    if (!sel && rows.length) setSel(rows[0]);
  }, [rows, sel]);

  // Which agents have an item with the same name (to spot ones missing elsewhere).
  const owners = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of rows) {
      const k = r.name.toLowerCase();
      if (!m.has(k)) m.set(k, new Set());
      m.get(k)!.add(r.agent.id);
    }
    return m;
  }, [rows]);

  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => `${r.name} ${r.description ?? ""} ${r.source ?? ""}`.toLowerCase().includes(q)) : rows;

  useEffect(() => {
    if (ready && !loading) onCount(shown.length);
  }, [shown.length, loading, ready]);

  return (
    <div className="split">
      <div className="list">
        <div className="listscroll">
          {shown.map((r) => {
            const n = owners.get(r.name.toLowerCase())?.size ?? 1;
            return (
              <button
                key={r.agent.id + r.path}
                className={`row ${sel?.path === r.path && sel?.agent.id === r.agent.id ? "on" : ""}`}
                onClick={() => setSel(r)}
              >
                <div className="rt">
                  {r.name}
                  {kind === "skills" && multi && n === 1 && <span className="badge">仅 {r.agent.name}</span>}
                </div>
                {r.description && <div className="rs">{r.description}</div>}
                <div className="rm">
                  <span className="dot" style={{ ["--c" as string]: TINT[r.agent.type] }} />
                  <span
                    className="who"
                    style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {multi ? r.agent.name : r.source || r.agent.name}
                  </span>
                  <span className="sp" />
                  <span>{fmtTime(r.mtime)}</span>
                </div>
              </button>
            );
          })}
          {!loading && shown.length === 0 && <div className="empty">{q ? "没有匹配项" : EMPTY[kind]}</div>}
        </div>
      </div>

      <section className="detail">
        {sel ? (
          <>
            <div className="dhead">
              <div className="dtitle">{sel.name}</div>
              <div className="dmeta">
                <span className="mi">
                  <IconFolder />
                  <code>{sel.path}</code>
                </span>
                <span className="sep" />
                <span>{fmtSize(sel.size)}</span>
                <span className="sep" />
                <span>{fmtTime(sel.mtime)}</span>
              </div>
              <div className="dacts">
                <button className="btn p" onClick={() => text && writeText(text).then(() => toast("已复制内容"))}>
                  <IconCopy />
                  复制内容
                </button>
                <button className="btn" onClick={() => writeText(sel.path).then(() => toast("已复制路径"))}>
                  复制路径
                </button>
                <button
                  className="btn"
                  onClick={() => api.reveal(sel.agent.id, kind, sel.path).catch((e) => toast(errText(e)))}
                >
                  打开位置
                </button>
              </div>
            </div>
            <div className="docbody">
              {text === null ? <div className="empty">加载中…</div> : <Doc text={text} path={sel.path} />}
            </div>
          </>
        ) : (
          <div className="empty" style={{ margin: "auto" }}>
            {loading ? "加载中…" : "从左侧选择一项查看"}
          </div>
        )}
      </section>
    </div>
  );
}
