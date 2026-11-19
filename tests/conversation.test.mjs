import assert from "node:assert/strict";
import { test } from "node:test";
import { groupMsgs } from "../src/conversation.ts";

const msg = (role, kind, text, model) => ({ role, kind, text, ...(model && { model }) });

test("keeps replies in order and splits on model changes, including unknown models", () => {
  const msgs = [
    msg("user", "text", "question"),
    msg("assistant", "text", "unknown first"),
    msg("assistant", "text", "answer", "model-a"),
    msg("assistant", "tool_call", "call", "model-a"),
    msg("tool", "tool_result", "result"),
    msg("assistant", "text", "continued", "model-a"),
    msg("assistant", "thinking", "thought", "model-b"),
    msg("assistant", "text", "new answer", "model-b"),
    msg("assistant", "text", "unknown last"),
  ];
  const blocks = groupMsgs(msgs, false);
  assert.deepEqual(blocks.map((b) => [b.role, b.model]), [
    ["user", undefined], ["assistant", undefined], ["assistant", "model-a"],
    ["assistant", "model-b"], ["assistant", undefined],
  ]);
  assert.deepEqual(blocks.flatMap((b) => b.parts), msgs);
  assert.deepEqual(blocks[2].segs.map((s) => s.parts.map((p) => p.kind)), [
    ["text"], ["tool_call", "tool_result"], ["text"],
  ]);
});

test("hiding system content and appending a page preserve existing block and segment keys", () => {
  const msgs = [
    msg("system", "meta", "setup"),
    msg("user", "text", "question"),
    msg("assistant", "text", "answer", "model-a"),
    msg("assistant", "tool_call", "call", "model-a"),
  ];
  const hidden = groupMsgs(msgs, false);
  assert.deepEqual(groupMsgs(msgs, true).slice(1), hidden);
  const later = groupMsgs([...msgs, msg("tool", "tool_result", "result")], false);
  assert.deepEqual(later.map((b) => [b.id, b.segs.map((s) => s.id)]), [
    [1, [1]], [2, [2, 3]],
  ]);
  assert.equal(later[1].segs[1].parts.at(-1).kind, "tool_result");
});
