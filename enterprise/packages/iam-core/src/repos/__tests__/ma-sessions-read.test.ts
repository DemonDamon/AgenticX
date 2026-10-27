import { describe, expect, it } from "vitest";

import { clampLimit, mapEventRow, mapSessionRow, resolveCreatedRange } from "../ma-sessions-read";

describe("session read mappers", () => {
  it("mapEventRow rebuilds the wire event from columns and payload", () => {
    const view = mapEventRow({
      id: "evt",
      sessionId: "ses",
      seq: 3,
      threadId: null,
      type: "agent.message",
      createdAt: "2026-10-25T00:00:00.000Z",
      processedAt: null,
      payload: { content: [{ type: "text", text: "hi" }] },
    });
    expect(view.event).toEqual({
      type: "agent.message",
      id: "evt",
      session_id: "ses",
      seq: 3,
      created_at: "2026-10-25T00:00:00.000Z",
      content: [{ type: "text", text: "hi" }],
    });
    expect(view.event).not.toHaveProperty("thread_id");
  });

  it("mapSessionRow fills missing usage keys with zero", () => {
    const detail = mapSessionRow({
      id: "ses",
      tenantId: "ten",
      agentId: "agt",
      agentVersion: 1,
      source: "portal",
      status: "idle",
      usageTotals: { input_tokens: 2 },
      createdAt: "2026-10-25T00:00:00.000Z",
      updatedAt: "2026-10-25T00:00:00.000Z",
    });
    expect(detail.usage).toEqual({
      input_tokens: 2,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      tool_calls: 0,
      runtime_ms: 0,
    });
  });

  it("mapSessionRow parses MySQL JSON strings", () => {
    const detail = mapSessionRow({
      id: "ses",
      tenant_id: "ten",
      agent_id: "agt",
      agent_version: 2,
      source: "api",
      status: "idle",
      usage_totals: '{"output_tokens":4}',
      vault_ids: '["vault-1"]',
      resources: '[{"kind":"file"}]',
      metadata: '{"topic":"ma"}',
      stop_reason: "null",
      created_at: "2026-10-25T00:00:00.000Z",
      updated_at: "2026-10-25T00:00:00.000Z",
    });
    expect(detail.usage.output_tokens).toBe(4);
    expect(detail.usage.input_tokens).toBe(0);
    expect(detail.vaultIds).toEqual(["vault-1"]);
    expect(detail.resources).toEqual([{ kind: "file" }]);
    expect(detail.metadata).toEqual({ topic: "ma" });
    expect(detail.stopReason).toBeNull();
  });

  it("clampLimit clamps to bounds", () => {
    expect(clampLimit(undefined, 50, 200)).toBe(50);
    expect(clampLimit(0, 50, 200)).toBe(1);
    expect(clampLimit(900, 50, 200)).toBe(200);
    expect(clampLimit(12, 50, 200)).toBe(12);
  });

  it("module exports no write function", async () => {
    const mod = await import("../ma-sessions-read");
    expect(Object.keys(mod).some((key) => /^(insert|create|update|delete|append)/i.test(key))).toBe(false);
  });
});

describe("resolveCreatedRange", () => {
  it("resolveCreatedRange parses ISO bounds", () => {
    const range = resolveCreatedRange({ createdFrom: "2026-10-01T00:00:00.000Z" });
    expect(range.from?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(range.to).toBeNull();
  });

  it("resolveCreatedRange ignores invalid values", () => {
    expect(resolveCreatedRange({ createdFrom: "yesterday", createdTo: "" })).toEqual({ from: null, to: null });
  });
});
