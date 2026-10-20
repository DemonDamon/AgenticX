import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@agenticx/core-api";
import { findContinuableResponse } from "./turn-continuation";

function message(partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role" | "content">): ChatMessage {
  return {
    session_id: "A",
    tenant_id: "t",
    user_id: "u",
    created_at: "2026-10-20T00:00:00.000Z",
    ...partial,
  };
}

describe("findContinuableResponse", () => {
  it("returns the latest interrupted ordinary answer in the session", () => {
    const older = message({
      id: "a1",
      role: "assistant",
      content: "old",
      interruption: { reason: "failed", contentLength: 3 },
    });
    const latest = message({
      id: "a2",
      role: "assistant",
      content: "partial",
      interruption: { reason: "cancelled", contentLength: 7 },
    });
    const messages = [
      message({ id: "u1", role: "user", content: "q1" }),
      older,
      message({ id: "u2", role: "user", content: "q2" }),
      latest,
    ];
    expect(findContinuableResponse(messages, "A")?.id).toBe("a2");
  });

  it("returns undefined when the latest turn is complete, from the user, or deep research", () => {
    const complete = [
      message({ id: "u", role: "user", content: "q" }),
      message({ id: "a", role: "assistant", content: "done" }),
    ];
    expect(findContinuableResponse(complete, "A")).toBeUndefined();
    expect(findContinuableResponse([message({ id: "u", role: "user", content: "q" })], "A")).toBeUndefined();
    const research = message({
      id: "r",
      role: "assistant",
      content: "report",
      interruption: { reason: "disconnected", contentLength: 6 },
      deep_research: { runId: "run", status: "failed", events: [] },
    });
    expect(findContinuableResponse([research], "A")).toBeUndefined();
  });
});
