import type { Category, Paths } from "./api";

export const SOURCE_CATEGORIES = [
  { key: "sessions", label: "会话", example: "sessions/**/*.jsonl" },
  { key: "skills", label: "Skill", example: "skills/*/SKILL.md" },
  { key: "commands", label: "命令", example: "commands/**/*.md" },
  { key: "instructions", label: "指令", example: "AGENTS.md" },
] as const satisfies readonly { key: Category; label: string; example: string }[];

export type RuleOverrides = Partial<Record<Category, string>>;

export function savedRules(paths: Paths): RuleOverrides {
  return Object.fromEntries(SOURCE_CATEGORIES.map(({ key }) => [key, paths[key].join("\n")]));
}

/** An empty override disables the category; only an absent override inherits defaults. */
export function resolveRules(defaults: Paths | null, overrides: RuleOverrides): Paths | null {
  const rules: Paths = { sessions: [], skills: [], commands: [], instructions: [] };
  for (const { key } of SOURCE_CATEGORIES) {
    const override = overrides[key];
    if (override === undefined) {
      if (!defaults) return null;
      rules[key] = defaults[key];
    } else {
      rules[key] = [...new Set(override.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
    }
  }
  return rules;
}
