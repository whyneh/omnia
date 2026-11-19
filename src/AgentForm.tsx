import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errText, type Agent, type Category, type DetectedFolder, type Kind, type Paths } from "./api";
import { resolveRules, savedRules, SOURCE_CATEGORIES, type RuleOverrides } from "./agentPaths";
import { AgentIcon, IconFolder, KIND_LABEL } from "./icons";

const PRESETS = [
  { kind: "claude", path: "~/.claude" },
  { kind: "codex", path: "~/.codex" },
  { kind: "gemini", path: "~/.gemini" },
] as const;

type Result<T> = { key: string } & ({ value: T } | { error: string });

/** Key results to their inputs so a stale request never supplies defaults, counts, or a save target. */
function useAgentProbe<T>(key: string | null, run: () => Promise<T>, delay = 0) {
  const [result, setResult] = useState<Result<T> | null>(null);
  useEffect(() => {
    setResult(null);
    if (key === null) return;
    let live = true;
    const timer = window.setTimeout(() => {
      run().then(
        (value) => { if (live) setResult({ key, value }); },
        (error) => { if (live) setResult({ key, error: errText(error) }); },
      );
    }, delay);
    return () => { live = false; window.clearTimeout(timer); };
  }, [key, delay]);
  return key !== null && result?.key === key ? result : null;
}

export function AgentForm({ initial, agents, onSaved, onRemove, onClose }: {
  initial: Agent | null;
  agents: Agent[];
  onSaved: (a: Agent) => void;
  onRemove: (a: Agent) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const rootInput = useRef<HTMLInputElement>(null);
  const [root, setRoot] = useState(initial?.root ?? "");
  const [probeRevision, retryProbe] = useState(0);
  const [kindOverride, setKindOverride] = useState<Kind | null>(initial?.type ?? null);
  const [nameOverride, setNameOverride] = useState<string | null>(initial?.name ?? null);
  const [overrides, setOverrides] = useState<RuleOverrides>(() => initial ? savedRules(initial.paths) : {});
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [advanced, setAdvanced] = useState(false);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    rootInput.current?.focus();
    return () => el?.close();
  }, []);

  const input = root.trim();
  const detection = useAgentProbe(
    input ? JSON.stringify([input, probeRevision]) : null,
    () => api.detectFolder(input),
    250,
  );
  const detected: DetectedFolder | null = detection && "value" in detection ? detection.value : null;
  const rootError = detection && "error" in detection ? detection.error : null;
  const kind = kindOverride ?? detected?.kind ?? "generic";
  const needsDefaults = detected !== null && detected.kind !== kind;
  const preset = useAgentProbe(needsDefaults ? kind : null, () => api.defaultPaths(kind));
  const defaults: Paths | null = needsDefaults
    ? (preset && "value" in preset ? preset.value : null)
    : detected?.paths ?? null;
  const rules = useMemo(() => resolveRules(defaults, overrides), [defaults, overrides]);
  const name = nameOverride ?? (kindOverride && kindOverride !== detected?.kind ? KIND_LABEL[kindOverride] : detected?.name ?? "");

  const previewKey = detected && rules ? JSON.stringify([detected.root, rules]) : null;
  const preview = useAgentProbe(previewKey, () => api.previewPaths(detected!.root, rules!), 250);
  const counts = preview && "value" in preview ? preview.value : null;
  const configured = rules && SOURCE_CATEGORIES.some(({ key }) => rules[key].length > 0);
  const duplicate = detected && agents.find((a) => a.id !== initial?.id && a.root === detected.root);
  const busy = saving || removing || picking;

  const updateRoot = (value: string) => {
    setRoot(value);
    setActionError(null);
    // Also allows retrying a preset after creating its missing folder.
    retryProbe((n) => n + 1);
  };

  const chooseFolder = async () => {
    if (busy) return;
    setPicking(true);
    setActionError(null);
    try {
      const dir = await open({
        directory: true,
        title: "选择 Agent 数据目录",
        ...(detected ? { defaultPath: detected.root } : {}),
      });
      if (typeof dir === "string") updateRoot(dir);
    } catch (e) {
      setActionError(`无法打开文件夹选择器：${errText(e)}`);
    } finally {
      setPicking(false);
    }
  };

  const canSave = !busy && !confirmRemove && !!detected && !!rules && !!name.trim();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave || !detected || !rules) return;
    setSaving(true);
    setActionError(null);
    try {
      onSaved(await api.saveAgent({ id: initial?.id ?? "", root: detected.root, type: kind, paths: rules, name: name.trim(), enabled }));
    } catch (e) {
      setActionError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (busy || !initial || !confirmRemove) return;
    setRemoving(true);
    setActionError(null);
    try {
      await onRemove(initial);
    } catch (e) {
      setActionError(errText(e));
    } finally {
      setRemoving(false);
    }
  };

  const changeRule = (key: Category, value?: string) => setOverrides((previous) => {
    const next = { ...previous };
    if (value === undefined) delete next[key];
    else next[key] = value;
    return next;
  });

  return (
    <dialog
      className="modal agent-dialog"
      ref={dialog}
      aria-labelledby="agent-form-title"
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
    >
      <form className="agent-form" onSubmit={save}>
        <header>
          <span className="agent-form-icon"><IconFolder /></span>
          <div className="agent-form-heading">
            <h2 id="agent-form-title">{initial ? `编辑 ${initial.name}` : "添加 Agent 数据目录"}</h2>
            <p>Omnia 只读取会话和配置，不修改目录中的文件。</p>
          </div>
          <button type="button" className="x" aria-label="关闭" disabled={busy} onClick={onClose}>✕</button>
        </header>

        <div className="agent-form-body">
          <fieldset disabled={saving || removing}>
            <div className="agent-root">
              <label htmlFor="agent-root">数据目录</label>
              <div className="agent-root-input">
                <input
                  id="agent-root" ref={rootInput} value={root} onChange={(e) => updateRoot(e.target.value)}
                  placeholder="例如 ~/.codex 或 C:\Users\你\.codex"
                  aria-invalid={!!rootError} aria-describedby="agent-root-status" spellCheck={false}
                  autoComplete="off" readOnly={picking}
                />
                <button type="button" className="btn" disabled={picking} onClick={chooseFolder}>
                  <IconFolder />{picking ? "选择中…" : "浏览…"}
                </button>
              </div>
              {!initial && (
                <div className="agent-presets" aria-label="常用目录">
                  <span>常用目录</span>
                  {PRESETS.map((p) => (
                    <button key={p.kind} type="button" className={`btn${input === p.path ? " on" : ""}`}
                      disabled={picking} title={KIND_LABEL[p.kind]} onClick={() => updateRoot(p.path)}>
                      <AgentIcon kind={p.kind} /><code>{p.path}</code>
                    </button>
                  ))}
                </div>
              )}
              <div id="agent-root-status" className={`agent-root-status${rootError ? " error" : ""}`} role="status">
                {rootError ? <>{rootError} <button type="button" className="link" onClick={() => retryProbe((n) => n + 1)}>重试</button></> :
                  !input ? "选择 Agent 的数据根目录，不是代码项目目录。" :
                  !detected ? "正在检查目录…" :
                  detected.kind === "generic" ? "未识别到已知 Agent，可手动选择类型或使用通用。" :
                  `识别为 ${KIND_LABEL[detected.kind]}`}
                {detected && detected.root !== input && <code title={detected.root}>{detected.root}</code>}
              </div>
              {duplicate && <p className="agent-alert">与「{duplicate.name}」使用同一个目录，请确认是否需要单独的规则。</p>}
            </div>

            {(initial || detected) && (
              <>
                <div className="agent-fields">
                  <label>
                    <span>显示名称</span>
                    <input value={name} onChange={(e) => setNameOverride(e.target.value)} required />
                  </label>
                  <label>
                    <span>解析类型</span>
                    <select value={kindOverride ?? "auto"} onChange={(e) => setKindOverride(e.target.value === "auto" ? null : e.target.value as Kind)}>
                      <option value="auto">自动识别{detected ? ` · ${KIND_LABEL[detected.kind]}` : ""}</option>
                      {Object.entries(KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                </div>
                <section className="agent-preview" aria-labelledby="agent-preview-title">
                  <div className="agent-preview-title">
                    <h3 id="agent-preview-title">文件预览</h3>
                    <span role="status">
                      {!detected ? "目录通过检查后显示文件数" :
                        preset && "error" in preset ? `无法加载默认规则：${preset.error}` :
                        !rules ? "正在加载路径规则…" :
                        preview && "error" in preview ? `预览失败：${preview.error}` :
                        counts ? "按当前路径规则统计" : "正在统计匹配文件…"}
                    </span>
                  </div>
                  <dl>
                    {SOURCE_CATEGORIES.map(({ key, label }) => (
                      <div key={key}><dt>{label}</dt><dd>{counts?.[key] ?? "—"}</dd></div>
                    ))}
                  </dl>
                  {rules && !configured ? (
                    <p className="agent-alert">尚未设置路径规则。可展开下方高级设置，指定要读取的文件。</p>
                  ) : counts && Object.values(counts).every((n) => n === 0) ? (
                    <p className="agent-alert">暂未匹配到文件。请检查目录、解析类型或路径规则；新建目录也可以先保存。</p>
                  ) : counts && counts.sessions === 0 ? (
                    <p className="agent-alert">已找到其他文件，暂未找到会话。</p>
                  ) : null}
                </section>
                <details className="agent-advanced" open={advanced} onToggle={(e) => setAdvanced(e.currentTarget.open)}>
                  <summary>高级设置 · 路径规则</summary>
                  <div className="agent-rules">
                    <div className="agent-rules-help">
                      <p>每行一条路径规则；支持相对路径、绝对路径和 <code>**</code>。留空则不读取该类别。</p>
                      {initial && <p>更换目录或解析类型不会替换已保存的规则。</p>}
                      {defaults && Object.keys(overrides).length > 0 && (
                        <button type="button" className="link" onClick={() => setOverrides({})}>全部使用当前类型的默认规则</button>
                      )}
                    </div>
                    {SOURCE_CATEGORIES.map(({ key, label, example }) => {
                      const value = overrides[key] ?? defaults?.[key].join("\n") ?? "";
                      return (
                        <div className="pathrow" key={key}>
                          <div className="pathlabel">
                            <label htmlFor={`agent-rule-${key}`}>{label}</label>
                            <span className="grow" />
                            {defaults && overrides[key] !== undefined && (
                              <button type="button" className="link" onClick={() => changeRule(key)}>使用默认</button>
                            )}
                          </div>
                          <textarea id={`agent-rule-${key}`} rows={Math.min(4, Math.max(1, value.split("\n").length))}
                            spellCheck={false} placeholder={example} value={value} onChange={(e) => changeRule(key, e.target.value)} />
                        </div>
                      );
                    })}
                  </div>
                </details>
                {initial && (
                  <label className="check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> 在「全部」中启用此来源</label>
                )}
              </>
            )}
          </fieldset>
        </div>

        <footer>
          {actionError && <p className="agent-alert error" role="alert">{actionError}</p>}
          {confirmRemove && <p className="agent-alert">只从 Omnia 移除此来源，不删除磁盘文件。</p>}
          <div className="agent-form-actions">
            {initial && (confirmRemove ? (
              <button type="button" className="btn danger" disabled={busy} onClick={remove}>{removing ? "移除中…" : "确认移除"}</button>
            ) : (
              <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirmRemove(true)}>移除来源</button>
            ))}
            <span className="grow" />
            <button type="button" className="btn" disabled={busy} onClick={confirmRemove ? () => setConfirmRemove(false) : onClose}>取消</button>
            {!confirmRemove && <button className="btn p" type="submit" disabled={!canSave}>{saving ? "保存中…" : initial ? "保存更改" : "添加来源"}</button>}
          </div>
        </footer>
      </form>
    </dialog>
  );
}
