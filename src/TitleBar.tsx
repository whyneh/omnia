import { useEffect, useState, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconRefresh, IconSearch, IconWinClose, IconWinMax, IconWinMin, IconWinRestore } from "./icons";

/** The window handle is only reachable inside Tauri; the browser preview stubs it. */
function handle() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

const call = (fn: (w: NonNullable<ReturnType<typeof handle>>) => Promise<unknown>) => {
  const w = handle();
  if (w) fn(w).catch(() => {});
};

/** Brand, the global search field, and the window chrome. */
export function TitleBar({
  query,
  onQuery,
  searchRef,
  placeholder,
  syncing,
  onSync,
}: {
  query: string;
  onQuery: (v: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  placeholder: string;
  syncing: boolean;
  onSync: () => void;
}) {
  const [maxed, setMaxed] = useState(false);

  useEffect(() => {
    const w = handle();
    if (!w) return;
    let alive = true;
    const read = () =>
      w
        .isMaximized()
        .then((v) => alive && setMaxed(!!v))
        .catch(() => {});
    read();
    let off: (() => void) | undefined;
    w.onResized(read)
      .then((f) => {
        off = f;
      })
      .catch(() => {});
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="tb-left" data-tauri-drag-region>
        <span className="logo" data-tauri-drag-region>
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="#fff"
            strokeWidth="1.9"
            strokeLinecap="round"
            data-tauri-drag-region
          >
            <circle cx="8" cy="8" r="4.8" />
            <path d="M8 1.2v2.6M8 12.2v2.6M1.2 8h2.6M12.2 8h2.6" />
          </svg>
        </span>
        <b data-tauri-drag-region>Omnia</b>
      </div>

      <div className="tb-mid" data-tauri-drag-region>
        <div className="search">
          <IconSearch />
          <input
            ref={searchRef}
            placeholder={placeholder}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            spellCheck={false}
          />
          <kbd>CTRL K</kbd>
        </div>
      </div>

      <button
        className={`iconbtn tb-sync ${syncing ? "spin" : ""}`}
        title={syncing ? "正在扫描会话文件…" : "重新扫描会话索引"}
        disabled={syncing}
        onClick={onSync}
      >
        <IconRefresh />
      </button>

      <div className="wcs">
        <button className="wc" title="最小化" onClick={() => call((w) => w.minimize())}>
          <IconWinMin />
        </button>
        <button
          className="wc"
          title={maxed ? "向下还原" : "最大化"}
          onClick={() => call((w) => w.toggleMaximize())}
        >
          {maxed ? <IconWinRestore /> : <IconWinMax />}
        </button>
        <button className="wc close" title="关闭" onClick={() => call((w) => w.close())}>
          <IconWinClose />
        </button>
      </div>
    </header>
  );
}
