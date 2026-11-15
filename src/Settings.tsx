import { useEffect, useState, type ReactElement } from "react";
import { IconInfo, IconSliders } from "./icons";
import { DEFAULTS, Prefs, StartTab } from "./prefs";

type Tab = "general" | "about";

const TABS: { key: Tab; label: string; icon: () => ReactElement }[] = [
  { key: "general", label: "通用", icon: IconSliders },
  { key: "about", label: "关于", icon: IconInfo },
];

const START_OPTS: { value: StartTab; label: string }[] = [
  { value: "sessions", label: "会话" },
  { value: "skills", label: "Skill" },
  { value: "commands", label: "命令" },
  { value: "instructions", label: "指令" },
];

/** ~/.omnia/config.json -> ~/.omnia/index.db */
function indexPath(configPath: string) {
  if (!configPath) return "~/.omnia/index.db";
  const sep = configPath.includes("\\") ? "\\" : "/";
  return configPath.replace(/[\\/][^\\/]+$/, "") + sep + "index.db";
}

export function Settings({
  prefs,
  onPrefs,
  configPath,
  onClose,
}: {
  prefs: Prefs;
  onPrefs: (p: Prefs) => void;
  configPath: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("general");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => onPrefs({ ...prefs, [k]: v });

  const ver = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings" role="dialog" aria-label="设置">
        <nav className="snav">
          <div className="ttl">设置</div>
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
              <t.icon />
              {t.label}
            </button>
          ))}
          <div className="ver">Omnia {ver}</div>
        </nav>

        <div className="spane">
          <header>
            <h2>{TABS.find((t) => t.key === tab)!.label}</h2>
            <button className="x" onClick={onClose} title="关闭">
              ✕
            </button>
          </header>

          <div className="sbody">
            {tab === "general" && (
              <>
                <div className="group">
                  <h4>启动</h4>
                  <div className="field">
                    <div className="lab">
                      <b>启动时显示</b>
                      <span>打开软件后默认停在哪个类别。</span>
                    </div>
                    <select
                      className="sel"
                      value={prefs.startTab}
                      onChange={(e) => set("startTab", e.target.value as StartTab)}
                    >
                      {START_OPTS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <div className="lab">
                      <b>记住上次选择的来源</b>
                      <span>下次打开时直接停在上次看的那个 agent。</span>
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={prefs.rememberScope}
                        onChange={(e) => set("rememberScope", e.target.checked)}
                      />
                      <span className="sw" />
                    </label>
                  </div>
                </div>

                <div className="group">
                  <h4>索引</h4>
                  <div className="field">
                    <div className="lab">
                      <b>窗口获得焦点时重建索引</b>
                      <span>只重建「会话」缓存；Skill、命令、指令每次都是实时读取。</span>
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={prefs.autoIndexOnFocus}
                        onChange={(e) => set("autoIndexOnFocus", e.target.checked)}
                      />
                      <span className="sw" />
                    </label>
                  </div>
                </div>

                <div className="group">
                  <h4>会话阅读</h4>
                  <div className="field">
                    <div className="lab">
                      <b>默认显示系统注入</b>
                      <span>打开会话时连同系统提示、注入内容一起显示。</span>
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={prefs.showMeta}
                        onChange={(e) => set("showMeta", e.target.checked)}
                      />
                      <span className="sw" />
                    </label>
                  </div>
                  <div className="field">
                    <div className="lab">
                      <b>默认展开工具调用</b>
                      <span>打开会话时把所有工具调用的完整内容展开。</span>
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={prefs.expandTools}
                        onChange={(e) => set("expandTools", e.target.checked)}
                      />
                      <span className="sw" />
                    </label>
                  </div>
                </div>
              </>
            )}

            {tab === "about" && (
              <>
                <div className="group">
                  <h4>版本</h4>
                  <div className="kvrow">
                    <i>Omnia</i>
                    <b>{ver}</b>
                  </div>
                </div>
                <div className="group">
                  <h4>位置</h4>
                  <div className="kvrow">
                    <i>配置</i>
                    <b>{configPath || "~/.omnia/config.json"}</b>
                  </div>
                  <div className="kvrow">
                    <i>索引缓存</i>
                    <b>{indexPath(configPath)}</b>
                  </div>
                  <div className="note">索引库是纯缓存，删掉后下次启动会自动重建。</div>
                </div>
                <div className="group">
                  <h4>行为</h4>
                  <div className="note">
                    不会修改、删除或同步任何 agent 目录下的文件。移除一个 agent 只影响 Omnia 自己的配置。
                  </div>
                </div>
                <div className="group">
                  <h4>重置</h4>
                  <div className="field">
                    <div className="lab">
                      <b>恢复默认设置</b>
                      <span>把通用里的全部选项还原成初始状态。不影响已建立的索引。</span>
                    </div>
                    <button
                      className="btn"
                      onClick={() => onPrefs(DEFAULTS)}
                    >
                      恢复默认
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
