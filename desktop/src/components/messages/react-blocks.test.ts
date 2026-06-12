import { describe, expect, it } from "vitest";
import type { Message } from "../../store";
import { expandMessagesToTopLevelRows } from "./react-blocks";
import { VIEW_IMAGE_INJECT_METADATA_SOURCE } from "../../utils/view-image-inject";

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
