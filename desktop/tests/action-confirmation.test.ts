import { describe, expect, it } from "vitest";

import {
  buildActionConfirmationAnswer,
  findResolvableActionConfirmation,
  formatActionConfirmationCountdown,
  isActionConfirmationExpired,
  matchActionConfirmationReply,
  parseActionConfirmationContext,
  remainingActionConfirmationMs,
  type PendingActionConfirmation,
} from "../src/utils/action-confirmation";

function baseCtx(overrides: Record<string, unknown> = {}) {
  return {
    kind: "action_confirmation",
    title: "确认发送这封邮件？",
    summary: [
      { label: "发件人", value: "a@agent.qq.com" },
      { label: "收件人", value: "b@qq.com" },
    ],
    approve_label: "确认发送",
    reject_label: "取消",
    source: "Agent Mail",
    expires_at_ms: 1_800_000_000_000,
    ...overrides,
  };
}

describe("parseActionConfirmationContext", () => {
  it("parses a valid action_confirmation context", () => {
    const parsed = parseActionConfirmationContext({
      requestId: "req-1",
      sessionId: "sess-1",
      agentId: "meta",
      context: baseCtx(),
    });
    expect(parsed).toMatchObject({
      requestId: "req-1",
      sessionId: "sess-1",
      agentId: "meta",
      title: "确认发送这封邮件？",
      approveLabel: "确认发送",
      rejectLabel: "取消",
      source: "Agent Mail",
      expiresAtMs: 1_800_000_000_000,
      status: "pending",
    });
    expect(parsed?.summary).toEqual([
      { label: "发件人", value: "a@agent.qq.com" },
      { label: "收件人", value: "b@qq.com" },
    ]);
  });

  it("returns null when requestId / sessionId / title missing", () => {
    expect(
      parseActionConfirmationContext({
        requestId: "",
        sessionId: "sess-1",
        context: baseCtx(),
      }),
    ).toBeNull();
    expect(
      parseActionConfirmationContext({
        requestId: "req-1",
        sessionId: "",
        context: baseCtx(),
      }),
    ).toBeNull();
    expect(
      parseActionConfirmationContext({
        requestId: "req-1",
        sessionId: "sess-1",
        context: baseCtx({ title: "" }),
      }),
    ).toBeNull();
  });

  it("returns null for non-action kinds", () => {
    expect(
      parseActionConfirmationContext({
        requestId: "req-1",
        sessionId: "sess-1",
        context: baseCtx({ kind: "clarification" }),
      }),
    ).toBeNull();
  });

  it("truncates summary and drops unknown fields", () => {
    const longLabel = "L".repeat(80);
    const longValue = "V".repeat(1200);
    const summary = Array.from({ length: 20 }, (_, i) => ({
      label: i === 0 ? longLabel : `k${i}`,
      value: i === 0 ? longValue : `v${i}`,
      extra: "drop-me",
    }));
    const parsed = parseActionConfirmationContext({
      requestId: "req-1",
      sessionId: "sess-1",
      context: baseCtx({
        summary,
        secret: "should-not-leak",
        oauth_token: "x",
      }),
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.summary).toHaveLength(12);
    expect(parsed!.summary[0]!.label).toHaveLength(40);
    expect(parsed!.summary[0]!.value).toHaveLength(1000);
    expect(parsed).not.toHaveProperty("secret");
    expect(JSON.stringify(parsed)).not.toContain("should-not-leak");
  });
});

describe("matchActionConfirmationReply", () => {
  it("matches exact approve / reject phrases", () => {
    expect(matchActionConfirmationReply("确认")).toBe("approved");
    expect(matchActionConfirmationReply("确认发送")).toBe("approved");
    expect(matchActionConfirmationReply(" YES ")).toBe("approved");
    expect(matchActionConfirmationReply("取消")).toBe("rejected");
    expect(matchActionConfirmationReply("No")).toBe("rejected");
  });

  it("rejects natural language that only contains the phrase", () => {
    expect(matchActionConfirmationReply("我还没确认")).toBeNull();
    expect(matchActionConfirmationReply("先不要取消任务")).toBeNull();
    expect(matchActionConfirmationReply("ok 然后继续")).toBeNull();
  });
});

describe("findResolvableActionConfirmation", () => {
  const pending = (overrides: Partial<PendingActionConfirmation> = {}): PendingActionConfirmation => ({
    requestId: "req-1",
    sessionId: "sess-1",
    agentId: "meta",
    title: "确认？",
    summary: [],
    approveLabel: "确认执行",
    rejectLabel: "取消",
    status: "pending",
    expiresAtMs: Date.now() + 60_000,
    ...overrides,
  });

  it("returns hit for a single pending card on the pane session", () => {
    const result = findResolvableActionConfirmation({
      messages: [{ actionConfirmation: pending(), ownerSessionId: "sess-1" }],
      paneSessionId: "sess-1",
    });
    expect(result.kind).toBe("hit");
    if (result.kind === "hit") {
      expect(result.confirmation.requestId).toBe("req-1");
    }
  });

  it("returns ambiguous when multiple pending cards exist", () => {
    const result = findResolvableActionConfirmation({
      messages: [
        { actionConfirmation: pending({ requestId: "a" }), ownerSessionId: "sess-1" },
        { actionConfirmation: pending({ requestId: "b" }), ownerSessionId: "sess-1" },
      ],
      paneSessionId: "sess-1",
    });
    expect(result.kind).toBe("ambiguous");
  });

  it("ignores cards owned by another session", () => {
    const result = findResolvableActionConfirmation({
      messages: [
        { actionConfirmation: pending({ sessionId: "sess-other" }), ownerSessionId: "sess-other" },
      ],
      paneSessionId: "sess-1",
    });
    expect(result.kind).toBe("none");
  });

  it("returns expired when TTL has passed", () => {
    const now = 2_000_000_000_000;
    const result = findResolvableActionConfirmation({
      messages: [
        {
          actionConfirmation: pending({ expiresAtMs: now - 1 }),
          ownerSessionId: "sess-1",
        },
      ],
      paneSessionId: "sess-1",
      nowMs: now,
    });
    expect(result.kind).toBe("expired");
  });
});

describe("isActionConfirmationExpired / countdown", () => {
  it("detects expiry by expiresAtMs", () => {
    expect(
      isActionConfirmationExpired({ expiresAtMs: 100, status: "pending" }, 101),
    ).toBe(true);
    expect(
      isActionConfirmationExpired({ expiresAtMs: 200, status: "pending" }, 100),
    ).toBe(false);
  });

  it("formats countdown mm:ss", () => {
    expect(formatActionConfirmationCountdown(125_000)).toBe("02:05");
    expect(remainingActionConfirmationMs({ expiresAtMs: 1_000 }, 800)).toBe(200);
  });
});

describe("buildActionConfirmationAnswer", () => {
  it("maps decision to selected_options labels for /api/clarify", () => {
    expect(
      buildActionConfirmationAnswer(
        { approveLabel: "确认发送", rejectLabel: "取消" },
        "approved",
      ),
    ).toEqual({ answerText: "", selectedOptions: ["确认发送"] });
    expect(
      buildActionConfirmationAnswer(
        { approveLabel: "确认发送", rejectLabel: "取消" },
        "rejected",
      ),
    ).toEqual({ answerText: "", selectedOptions: ["取消"] });
  });
});
