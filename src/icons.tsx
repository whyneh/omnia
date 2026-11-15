import { Kind } from "./api";

/** Per-agent glyph + tint. Deliberately abstract marks, not vendor logos. */
export const TINT: Record<string, string> = {
  claude: "#c4693f",
  codex: "#4a7c63",
  gemini: "#4e6fb8",
  generic: "#7d8590",
};

export const KIND_LABEL: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  generic: "通用",
};

export function AgentIcon({ kind, className }: { kind: Kind | string; className?: string }) {
  const k = kind in TINT ? kind : "generic";
  return (
    <span className={className ?? "ico"} style={{ ["--c" as string]: TINT[k] }}>
      {k === "claude" && (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M8 1.7v12.6M1.7 8h12.6M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8" />
        </svg>
      )}
      {k === "codex" && (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
          <path d="M8 1.9l5.3 3v6.2L8 14.1l-5.3-3V4.9z" />
          <path d="M8 5.3v5.4M5.6 6.7l4.8 2.6M10.4 6.7L5.6 9.3" />
        </svg>
      )}
      {k === "gemini" && (
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1.4c0 3.7 2.9 6.6 6.6 6.6C10.9 8 8 10.9 8 14.6 8 10.9 5.1 8 1.4 8 5.1 8 8 5.1 8 1.4z" />
        </svg>
      )}
      {k === "generic" && (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
          <path d="M2.6 4.2h10.8M2.6 8h10.8M2.6 11.8h6.4" />
        </svg>
      )}
    </span>
  );
}

/* Category marks — one per view, drawn on the same 16px grid as the rest. */
export const IconChat = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    <path d="M13.4 7.6c0 2.8-2.4 5-5.4 5-.7 0-1.4-.1-2-.3L2.6 13.4l1.1-2.6a4.8 4.8 0 0 1-1.1-3.2c0-2.8 2.4-5 5.4-5s5.4 2.2 5.4 5z" />
  </svg>
);

export const IconSkill = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    <path d="M8 1.9c0 3.1 2.9 5.1 6.1 5.1-3.2 0-6.1 2-6.1 5.1 0-3.1-2.9-5.1-6.1-5.1C5.1 7 8 5 8 1.9z" />
    <path d="M12.4 11.3v2.8M11 12.7h2.8" strokeLinecap="round" />
  </svg>
);

export const IconCommand = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5.6 3.6L2.4 8l3.2 4.4M10.4 3.6L13.6 8l-3.2 4.4" />
  </svg>
);

export const IconDoc = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    <path d="M9.2 1.9H4.6a1.5 1.5 0 0 0-1.5 1.5v9.2a1.5 1.5 0 0 0 1.5 1.5h6.8a1.5 1.5 0 0 0 1.5-1.5V5.5z" />
    <path d="M9.2 1.9v3.6h3.7M5.6 9h4.8M5.6 11.4h3.2" strokeLinecap="round" />
  </svg>
);

export const IconAll = () => (
  <svg viewBox="0 0 16 16" fill="currentColor">
    <rect x="2" y="2" width="5" height="5" rx="1.5" />
    <rect x="9" y="2" width="5" height="5" rx="1.5" />
    <rect x="2" y="9" width="5" height="5" rx="1.5" />
    <rect x="9" y="9" width="5" height="5" rx="1.5" />
  </svg>
);

export const IconSearch = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="7" cy="7" r="4.6" />
    <path d="M10.5 10.5L14 14" strokeLinecap="round" />
  </svg>
);

export const IconRefresh = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M13.4 8a5.4 5.4 0 1 1-1.6-3.8" />
    <path d="M13.6 2.3v2.9h-2.9" strokeLinejoin="round" />
  </svg>
);

export const IconPlus = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M8 3.4v9.2M3.4 8h9.2" />
  </svg>
);

export const IconGear = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.6v1.5M8 12.9v1.5M1.6 8h1.5M12.9 8h1.5M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1" strokeLinecap="round" />
  </svg>
);

export const IconChevron = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3.6L10.6 8 6 12.4" />
  </svg>
);

export const IconFolder = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.4 1.6h4.6A1.5 1.5 0 0 1 14 6.1v5.4A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z" />
  </svg>
);

export const IconCopy = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    <rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.6" />
    <path d="M10.6 5.4V4a1.6 1.6 0 0 0-1.6-1.6H4a1.6 1.6 0 0 0-1.6 1.6v5a1.6 1.6 0 0 0 1.6 1.6h1.4" />
  </svg>
);

/** A person — used for the "you" side of a conversation. */
export const IconUser = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="5.3" r="2.5" />
    <path d="M2.9 13.5a5.1 5.1 0 0 1 10.2 0" />
  </svg>
);

/** Terminal — tool calls and their results. */
export const IconTool = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1.8" y="2.7" width="12.4" height="10.6" rx="2" />
    <path d="M4.9 6.3l2 1.7-2 1.7M8.7 9.9h2.5" />
  </svg>
);

export const IconEye = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.6 8S4 3.9 8 3.9 14.4 8 14.4 8 12 12.1 8 12.1 1.6 8 1.6 8z" />
    <circle cx="8" cy="8" r="1.8" />
  </svg>
);

export const IconEyeOff = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.4 2.4l11.2 11.2" />
    <path d="M6.3 4.2A6.6 6.6 0 0 1 8 4c4 0 6.4 4 6.4 4a11.4 11.4 0 0 1-2 2.3M4.3 5.4C2.6 6.5 1.6 8 1.6 8S4 12 8 12a6.5 6.5 0 0 0 2.2-.4" />
    <path d="M6.7 6.7a1.8 1.8 0 0 0 2.6 2.6" />
  </svg>
);

export const IconSliders = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M2.4 4.6h11.2M2.4 11.4h11.2" />
    <circle cx="6" cy="4.6" r="1.9" fill="var(--glass-2)" />
    <circle cx="10.4" cy="11.4" r="1.9" fill="var(--glass-2)" />
  </svg>
);

export const IconInfo = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="8" cy="8" r="6.1" />
    <path d="M8 7.2v4" />
    <circle cx="8" cy="4.9" r="0.85" fill="currentColor" stroke="none" />
  </svg>
);

/* Window controls — 10px optical size, thin strokes like the system chrome. */
export const IconWinMin = () => (
  <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
    <path d="M0.5 5.5h9" />
  </svg>
);

export const IconWinMax = () => (
  <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
    <rect x="0.5" y="0.5" width="9" height="9" />
  </svg>
);

export const IconWinRestore = () => (
  <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
    <rect x="0.5" y="2.5" width="7" height="7" />
    <path d="M2.5 2.5V0.5h7v7h-2" />
  </svg>
);

export const IconWinClose = () => (
  <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
    <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
  </svg>
);
