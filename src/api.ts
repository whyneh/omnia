import { invoke } from "@tauri-apps/api/core";

export type Kind = "claude" | "codex" | "gemini" | "generic";
export type Category = "sessions" | "skills" | "commands" | "instructions";

export interface Paths {
  sessions: string[];
  skills: string[];
  commands: string[];
  instructions: string[];
}

export interface Agent {
  id: string;
  name: string;
  type: Kind;
  root: string;
  paths: Paths;
  enabled: boolean;
}

export interface SessionRow {
  agent_id: string;
  path: string;
  session_id: string | null;
  title: string | null;
  cwd: string | null;
  model: string | null;
  started: string | null;
  updated: string | null;
  msg_count: number;
  size: number;
  mtime: number;
  snippet: string | null;
}

export interface Msg {
  role: "user" | "assistant" | "system" | "tool";
  kind: "text" | "thinking" | "tool_call" | "tool_result" | "meta" | "raw";
  text: string;
  name?: string;
  ts?: string;
}

export interface SessionMeta {
  session_id: string | null;
  title: string | null;
  cwd: string | null;
  model: string | null;
  started: string | null;
  updated: string | null;
}

export interface SessionPage {
  meta: SessionMeta;
  total: number;
  offset: number;
  msgs: Msg[];
}

export interface Item {
  name: string;
  path: string;
  description: string | null;
  source: string | null;
  size: number;
  mtime: number;
}

/** A folder the sessions were started in — the sidebar's "项目". */
export interface Project {
  path: string;
  sessions: number;
  updated: string | null;
  mtime: number;
}

export interface Stats {
  scanned: number;
  updated: number;
  removed: number;
  failed: number;
}

export const api = {
  getConfig: () => invoke<{ agents: Agent[]; warning: string | null; config_path: string }>("get_config"),
  detectFolder: (root: string) => invoke<{ kind: Kind; name: string; paths: Paths }>("detect_folder", { root }),
  defaultPaths: (kind: Kind) => invoke<Paths>("default_paths", { kind }),
  previewPaths: (root: string, paths: Paths) => invoke<Record<Category, number>>("preview_paths", { root, paths }),
  saveAgent: (agent: Agent) => invoke<Agent>("save_agent", { agent }),
  removeAgent: (id: string) => invoke<void>("remove_agent", { id }),
  reorderAgents: (ids: string[]) => invoke<void>("reorder_agents", { ids }),
  refresh: (ids: string[]) => invoke<Record<string, Stats>>("refresh", { ids }),
  listSessions: (ids: string[], query: string, project: string | null, limit?: number) =>
    invoke<SessionRow[]>("list_sessions", { ids, query, project, limit }),
  listProjects: (ids: string[]) => invoke<Project[]>("list_projects", { ids }),
  readSession: (agentId: string, path: string, offset: number, limit: number) =>
    invoke<SessionPage>("read_session", { agentId, path, offset, limit }),
  listItems: (agentId: string, kind: "skills" | "commands" | "instructions") => invoke<Item[]>("list_items", { agentId, kind }),
  readItem: (agentId: string, kind: Category, path: string) => invoke<string>("read_item", { agentId, kind, path }),
  reveal: (agentId: string, kind: Category, path: string) => invoke<void>("reveal", { agentId, kind, path }),
};

/** Command that resumes a session in its own CLI, if the agent supports it. */
export function resumeCommand(kind: Kind, sessionId: string | null, cwd: string | null): string | null {
  if (!sessionId) return null;
  const cd = cwd ? `cd "${cwd}" && ` : "";
  if (kind === "claude") return `${cd}claude --resume ${sessionId}`;
  if (kind === "codex") return `${cd}codex resume ${sessionId}`;
  if (kind === "gemini") return `${cd}gemini --resume ${sessionId}`;
  return null;
}

export const fmtTime = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === "") return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  const y = d.getFullYear() === now.getFullYear() ? "" : `${d.getFullYear()}-`;
  return `${y}${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
};

/** Clock only — for rows that are already grouped under a day heading. */
export const fmtClock = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === "") return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** A time span; collapses to clock-only when both ends fall on the same day. */
export const fmtRange = (a: string | null | undefined, b: string | null | undefined) => {
  if (!a && !b) return "";
  const da = a ? new Date(a) : null;
  const db = b ? new Date(b) : null;
  if (da && db && da.toDateString() === db.toDateString()) return `${fmtClock(a)} → ${fmtClock(b)}`;
  return `${fmtTime(a)} → ${fmtTime(b)}`;
};

export const fmtSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

export const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e));

/** Last path segment(s) for compact project display. */
export const shortPath = (p: string | null) => {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").replace(/\/$/, "").split("/");
  return parts.slice(-2).join("/");
};

/** Folder name alone — what the project list shows. */
export const projectName = (p: string) => {
  const parts = p.replace(/\\/g, "/").replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || p;
};
