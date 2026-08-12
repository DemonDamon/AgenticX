import { describe, expect, it } from "vitest";
import type { Message } from "../../store";
import {
  collectTurnLinkedIds,
  collectTurnLinkedIdsForBlock,
  countSelectedConversationTurns,
  expandMessagesToTopLevelRows,
  expandSelectionToCompleteTurns,
} from "./react-blocks";
import { VIEW_IMAGE_INJECT_METADATA_SOURCE } from "../../utils/view-image-inject";

function msg(id: string, role: Message["role"], content = ""): Message {
  return { id, role, content };
}

describe("expandMessagesToTopLevelRows", () => {
  it("keeps view_image inject inside the following ReAct block", () => {
    const inject: Message = {
      id: "inject-1",
      role: "user",
      content: "",
      metadata: { source: VIEW_IMAGE_INJECT_METADATA_SOURCE },
    };
    const assistant: Message = {
      id: "asst-1",
      role: "assistant",
      content: "reply",
    };
    const rows = expandMessagesToTopLevelRows([inject, assistant]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("react");
    if (rows[0]?.kind === "react") {
      expect(rows[0].block.workMessages.map((m) => m.id)).toEqual(["inject-1", "asst-1"]);
    }
  });

  it("still splits real user messages from ReAct blocks", () => {
    const user: Message = { id: "u1", role: "user", content: "hi" };
    const assistant: Message = { id: "a1", role: "assistant", content: "hello" };
    const rows = expandMessagesToTopLevelRows([user, assistant]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ kind: "user", message: user });
    expect(rows[1]?.kind).toBe("react");
  });
});

describe("conversation-turn selection helpers", () => {
  const user = msg("u1", "user", "q");
  const a1 = msg("a1", "assistant", "thinking");
  const t1 = msg("t1", "tool", "tool-result");
  const a2 = msg("a2", "assistant", "final");
  const visible = [user, a1, t1, a2];
  const rows = expandMessagesToTopLevelRows(visible);

  it("links user click to the full following ReAct block", () => {
    const linked = collectTurnLinkedIds(user, rows, visible);
    expect(Array.from(linked).sort()).toEqual(["a1", "a2", "t1", "u1"]);
  });

  it("links assistant/tool click back to the preceding user question", () => {
    const linked = collectTurnLinkedIds(a2, rows, visible);
    expect(Array.from(linked).sort()).toEqual(["a1", "a2", "t1", "u1"]);
  });

  it("links ReAct block toggle to the preceding user question", () => {
    const linked = collectTurnLinkedIdsForBlock([a1, t1, a2], rows);
    expect(Array.from(linked).sort()).toEqual(["a1", "a2", "t1", "u1"]);
  });

  it("counts one turn even when many tool/assistant fragments are selected", () => {
    const selected = new Set(["u1", "a1", "t1", "a2"]);
    expect(countSelectedConversationTurns(rows, selected, visible)).toBe(1);
  });

  it("expands a partial assistant-only selection to the full turn", () => {
    const expanded = expandSelectionToCompleteTurns(new Set(["a2"]), rows, visible);
    expect(Array.from(expanded).sort()).toEqual(["a1", "a2", "t1", "u1"]);
  });
});
