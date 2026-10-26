import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeInternalMock = vi.fn();

vi.mock("../runtime-internal-client", () => ({
  runtimeInternal: (...args: unknown[]) => runtimeInternalMock(...args),
}));

const { emitMaResourceEvent } = await import("../webhook-events");

describe("emitMaResourceEvent", () => {
  beforeEach(() => {
    runtimeInternalMock.mockReset();
    vi.unstubAllEnvs();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("posts resource fields and derives resource_type", async () => {
    runtimeInternalMock.mockResolvedValue({});
    emitMaResourceEvent({
      tenantId: "tenant_1",
      type: "vault_credential.archived",
      resourceId: "cred_1",
      extra: { vault_id: "vault_1" },
    });
    await vi.waitFor(() => expect(runtimeInternalMock).toHaveBeenCalledTimes(1));
    const [method, path, body] = runtimeInternalMock.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(method).toBe("POST");
    expect(path).toBe("/internal/ma/webhook-events");
    expect(body.tenant_id).toBe("tenant_1");
    expect(body.type).toBe("vault_credential.archived");
    expect(body.resource_type).toBe("vault_credential");
    expect(body.resource_id).toBe("cred_1");
    expect(body.vault_id).toBe("vault_1");
    expect(body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(typeof body.occurred_at).toBe("string");

    runtimeInternalMock.mockClear();
    emitMaResourceEvent({
      tenantId: "tenant_1",
      type: "agent.version_published",
      resourceId: "agent_1",
      extra: { agent_id: "agent_1", version: 4 },
    });
    await vi.waitFor(() => expect(runtimeInternalMock).toHaveBeenCalledTimes(1));
    const published = runtimeInternalMock.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(published.resource_type).toBe("agent");
    expect(published.agent_id).toBe("agent_1");
    expect(published.version).toBe(4);

    runtimeInternalMock.mockClear();
    emitMaResourceEvent({ tenantId: "tenant_1", type: "memory_store.created", resourceId: "store_1" });
    await vi.waitFor(() => expect(runtimeInternalMock).toHaveBeenCalledTimes(1));
    expect((runtimeInternalMock.mock.calls[0]?.[2] as { resource_type: string }).resource_type).toBe("memory_store");
  });

  it("does not call the runtime when MA_WEBHOOK_EVENTS_ENABLED=0", () => {
    vi.stubEnv("MA_WEBHOOK_EVENTS_ENABLED", "0");
    emitMaResourceEvent({ tenantId: "tenant_1", type: "environment.created", resourceId: "env_1" });
    expect(runtimeInternalMock).not.toHaveBeenCalled();
  });

  it("does not throw when the runtime call rejects", async () => {
    runtimeInternalMock.mockRejectedValue(new Error("down"));
    expect(() => emitMaResourceEvent({ tenantId: "tenant_1", type: "environment.deleted", resourceId: "env_1" })).not.toThrow();
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith("[ma-webhook-event] down"));
  });

  it("warns after 2 seconds when the runtime call does not settle", async () => {
    vi.useFakeTimers();
    runtimeInternalMock.mockReturnValue(new Promise(() => {}));
    expect(() =>
      emitMaResourceEvent({ tenantId: "tenant_1", type: "schedule.deleted", resourceId: "sched_1", extra: { agent_id: "agent_1" } }),
    ).not.toThrow();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(console.warn).toHaveBeenCalledWith("[ma-webhook-event] timeout");
  });
});
