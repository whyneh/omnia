import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRules, savedRules } from "../src/agentPaths.ts";

const claude = { sessions: ["projects/*/*.jsonl"], skills: ["skills/*/SKILL.md"], commands: ["commands/**/*.md"], instructions: ["CLAUDE.md"] };
const codex = { sessions: ["sessions/**/*.jsonl"], skills: ["skills/*/SKILL.md"], commands: ["prompts/*.md"], instructions: ["AGENTS.md"] };

test("changing a new source's parser only updates fields still inheriting defaults", () => {
  const overrides = { sessions: " custom/**/*.jsonl\r\n\r\ncustom/**/*.jsonl ", skills: "" };
  assert.deepEqual(resolveRules(claude, overrides), { ...claude, sessions: ["custom/**/*.jsonl"], skills: [] });
  assert.deepEqual(resolveRules(codex, overrides), { ...codex, sessions: ["custom/**/*.jsonl"], skills: [] });
});

test("editing a saved source preserves all configured rules until a reset is requested", () => {
  const saved = { ...claude, sessions: ["custom/export.jsonl"], instructions: [] };
  const overrides = savedRules(saved);
  assert.deepEqual(resolveRules(null, overrides), saved);
  assert.deepEqual(resolveRules(codex, overrides), saved);
  delete overrides.sessions;
  assert.equal(resolveRules(null, overrides), null);
  assert.deepEqual(resolveRules(codex, overrides), { ...saved, sessions: codex.sessions });
});
