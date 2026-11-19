import type { Msg } from "./api";

interface Segment {
  kind: "text" | "process";
  parts: Msg[];
  /** Offset in the unfiltered transcript. */
  id: number;
}

interface Block {
  role: "user" | "assistant" | "system";
  parts: Msg[];
  segs: Segment[];
  id: number;
  model?: string;
}

/** Keep prose and process in source order without attributing unknown output to a model. */
export function groupMsgs(msgs: Msg[], showMeta: boolean): Block[] {
  const blocks: Block[] = [];
  for (const [id, msg] of msgs.entries()) {
    if (msg.kind === "meta") {
      if (showMeta) blocks.push({ role: "system", parts: [msg], segs: [], id });
      continue;
    }
    if (msg.kind === "text" && msg.role === "user") {
      blocks.push({ role: "user", parts: [msg], segs: [{ kind: "text", parts: [msg], id }], id });
      continue;
    }

    const fromModel = msg.role === "assistant" &&
      (msg.kind === "text" || msg.kind === "thinking" || msg.kind === "tool_call");
    const last = blocks.at(-1);
    // A tool result stays with the preceding call. A new model response starts a
    // separate block on a model change, including a change to/from unknown.
    const block = last?.role === "assistant" && (!fromModel || last.model === msg.model)
      ? last
      : { role: "assistant" as const, parts: [], segs: [], id, model: fromModel ? msg.model : undefined };
    if (block !== last) blocks.push(block);
    block.parts.push(msg);
    const kind = msg.kind === "text" ? "text" : "process";
    const segment = block.segs.at(-1);
    if (segment?.kind === kind) segment.parts.push(msg);
    else block.segs.push({ kind, parts: [msg], id });
  }
  return blocks;
}
