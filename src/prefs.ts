/** User preferences that are not part of the agent config (~/.omnia/config.json). */

export type StartTab = "sessions" | "skills" | "commands" | "instructions";
const TABS: StartTab[] = ["sessions", "skills", "commands", "instructions"];

export interface Prefs {
  /** Rebuild the session index when the window regains focus. */
  autoIndexOnFocus: boolean;
  /** Category shown on launch. */
  startTab: StartTab;
  /** Restore the last selected source on launch. */
  rememberScope: boolean;
  /** Session view: show system-injected messages by default. */
  showMeta: boolean;
  /** Session view: expand tool calls by default. */
  expandTools: boolean;
}

export const DEFAULTS: Prefs = {
  autoIndexOnFocus: true,
  startTab: "sessions",
  rememberScope: true,
  showMeta: false,
  expandTools: false,
};

const PREFS_KEY = "omnia.prefs";
const SCOPE_KEY = "omnia.scope";

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULTS;
    const p = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) };
    // Older builds could start on a view that no longer exists.
    if (!TABS.includes(p.startTab)) p.startTab = DEFAULTS.startTab;
    return p;
  } catch {
    return DEFAULTS;
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: preferences still apply for this session */
  }
}

export const loadScope = () => {
  try {
    return localStorage.getItem(SCOPE_KEY);
  } catch {
    return null;
  }
};

export const saveScope = (id: string) => {
  try {
    localStorage.setItem(SCOPE_KEY, id);
  } catch {
    /* ignore */
  }
};
