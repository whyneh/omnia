import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Agent, Category, Kind, Paths, api, errText } from "./api";
import { IconFolder } from "./icons";

const CATS: { key: Category; label: string; hint: string }[] = [
  { key: "sessions", label: "会话", hint: "决定会话列表；解析方式由类型决定" },
  { key: "skills", label: "Skill", hint: "通常是 skills/*/SKILL.md" },
  { key: "commands", label: "命令", hint: "自定义斜杠命令 / 提示词文件" },
  { key: "instructions", label: "指令", hint: "全局指令文件，如 CLAUDE.md" },
];
const KINDS: { v: Kind; label: string }[] = [
  { v: "claude", label: "Claude Code" },
  { v: "codex", label: "Codex" },
  { v: "gemini", label: "Gemini CLI" },
  { v: "generic", label: "通用（按原始文本显示会话）" },
];

const toText = (a: string[]) => a.join("\n");
const toList = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

type Draft = Omit<Agent, "paths"> & { paths: Record<Category, string> };
const toDraft = (a: Agent): Draft => ({
  ...a,
  paths: Object.fromEntries(CATS.map((c) => [c.key, toText(a.paths[c.key])])) as Record<Category, string>,
});
const fromDraft = (d: Draft): Agent => ({
  ...d,
  paths: Object.fromEntries(CATS.map((c) => [c.key, toList(d.paths[c.key])])) as unknown as Paths,
});

export function AgentForm({
  initial,
  onSaved,
  onRemove,
  onClose,
}: {
  initial: Agent | null;
  onSaved: (a: Agent) => void;
  onRemove: (a: Agent) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<Draft | null>(initial ? toDraft(initial) : null);
  const [defaults, setDefaults] = useState<Paths | null>(null);
  const [counts, setCounts] = useState<Partial<Record<Category, number>>>({});
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const pick = async () => {
    const dir = await open({ directory: true, title: "选择 agent 的配置文件夹" });
    if (typeof dir !== "string") return;
    try {
      const det = await api.detectFolder(dir);
      setD({
        ...(d ?? { id: "", enabled: true }),
        name: d?.name || det.name,
        type: det.kind,
        root: dir,
        paths: toDraft({ paths: det.paths } as Agent).paths,
      } as Draft);
      setErr(null);
    } catch (e) {
      setErr(errText(e));
    }
  };

  useEffect(() => {
    if (!initial) pick();
  }, []);

  useEffect(() => {
    if (d) api.defaultPaths(d.type).then(setDefaults);
  }, [d?.type]);

  // Live match counts, debounced.
  useEffect(() => {
    if (!d?.root) return;
    const t = setTimeout(() => {
      api.previewPaths(d.root, fromDraft(d).paths).then(setCounts, () => setCounts({}));
    }, 300);
    return () => clearTimeout(t);
  }, [d?.root, JSON.stringify(d?.paths)]);

  const save = async () => {
    if (!d) return;
    setSaving(true);
    try {
      onSaved(await api.saveAgent(fromDraft(d)));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const changeType = async (kind: Kind) => {
    if (!d) return;
    const p = await api.defaultPaths(kind);
    setD({ ...d, type: kind, paths: toDraft({ paths: p } as Agent).paths });
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${d ? "" : " compact"}`}>
        <header>
          <h2>{initial ? `编辑 ${initial.name}` : "添加 agent"}</h2>
          <button className="x" onClick={onClose}>
            ✕
          </button>
        </header>
        {!d ? (
          <div className="form-empty">
            <span className="femico">
              <IconFolder />
            </span>
            <p className="femp">
              选择一个 agent 的配置文件夹，例如 <code>~/.claude</code>。Omnia 会识别类型，并把名称和路径预填到下一步。
            </p>
            <div className="femrow">
              <button className="btn p" onClick={pick}>
                选择文件夹…
              </button>
              <button className="btn" onClick={onClose}>
                取消
              </button>
            </div>
            <p className="femhint">支持 Claude Code、Codex、Gemini CLI 与通用目录。</p>
            {err && <p className="error">{err}</p>}
          </div>
        ) : (
          <div className="form">
            <label>
              <span>名称</span>
              <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
            </label>
            <label>
              <span>根目录</span>
              <div className="inline">
                <input value={d.root} onChange={(e) => setD({ ...d, root: e.target.value })} />
                <button className="btn" onClick={pick}>浏览…</button>
              </div>
            </label>
            <label>
              <span>类型</span>
              <select value={d.type} onChange={(e) => changeType(e.target.value as Kind)}>
                {KINDS.map((k) => (
                  <option key={k.v} value={k.v}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} /> 启用
            </label>
            <p className="hint">路径为相对根目录的 glob，每行一条；也可写绝对路径。** 匹配多级目录。凭据文件（auth.json 等）始终被排除。</p>
            {CATS.map((c) => {
              const def = defaults ? toText(defaults[c.key]) : null;
              const dirty = def !== null && def !== d.paths[c.key];
              return (
                <div key={c.key} className="pathrow">
                  <div className="pathlabel">
                    <b>{c.label}</b>
                    <span className={`cnt ${counts[c.key] ? "" : "zero"}`}>{counts[c.key] ?? "…"} 个文件</span>
                    <span className="grow" />
                    {dirty && (
                      <button className="link" onClick={() => setD({ ...d, paths: { ...d.paths, [c.key]: def! } })}>
                        恢复默认
                      </button>
                    )}
                  </div>
                  <textarea
                    rows={Math.max(1, d.paths[c.key].split("\n").length)}
                    placeholder={c.hint}
                    spellCheck={false}
                    value={d.paths[c.key]}
                    onChange={(e) => setD({ ...d, paths: { ...d.paths, [c.key]: e.target.value } })}
                  />
                </div>
              );
            })}
            {err && <p className="error">{err}</p>}
            <footer>
              {initial &&
                (confirmRemove ? (
                  <span className="danger-confirm">
                    只从 Omnia 移除，不删除磁盘文件夹。
                    <button className="btn danger" onClick={() => onRemove(initial)}>
                      确认移除
                    </button>
                    <button className="btn" onClick={() => setConfirmRemove(false)}>取消</button>
                  </span>
                ) : (
                  <button className="btn ghost" onClick={() => setConfirmRemove(true)}>
                    移除
                  </button>
                ))}
              <span className="grow" />
              <button className="btn" onClick={onClose}>取消</button>
              <button className="btn p" disabled={saving} onClick={save}>
                {saving ? "保存中…" : "保存"}
              </button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
