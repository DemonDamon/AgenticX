import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AuditEvent } from "../types";
import { LocalAuditStore } from "./local-store";

function baseEvent(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    id: overrides.id ?? "evt-1",
    tenant_id: "tenant-1",
    event_time: "2026-08-10T00:00:00.000Z",
    event_type: "chat_call",
    user_id: "user-1",
    session_id: "sess-a",
    trace_id: "01JTRACEAAAAAAAAAAAAAAAAA",
    client_type: "web-portal",
    route: "third-party",
    prev_checksum: "GENESIS",
    checksum: "deadbeef",
    ...overrides,
  };
}

describe("LocalAuditStore trace/session filters", () => {
  async function storeWith(events: AuditEvent[]) {
    const dir = await mkdtemp(path.join(tmpdir(), "audit-trace-filter-"));
    // Bypass checksum chain for filter tests — LocalAuditStore still returns items when chain fails.
    const lines = events.map((event) => JSON.stringify(event)).join("\n");
    await writeFile(path.join(dir, "2026-08-10.jsonl"), lines, "utf-8");
    return new LocalAuditStore(dir);
  }

  const actor = {
    tenantId: "tenant-1",
    userId: "admin-1",
    scopes: ["audit:read:all"],
  };

  it("filters by trace_id only", async () => {
    const store = await storeWith([
      baseEvent({ id: "1", trace_id: "trace-a", session_id: "sess-1" }),
      baseEvent({ id: "2", trace_id: "trace-b", session_id: "sess-1" }),
    ]);
    const result = await store.query(actor, { tenant_id: "tenant-1", trace_id: "trace-a" });
    expect(result.items.map((item) => item.id)).toEqual(["1"]);
  });

  it("filters by session_id only", async () => {
    const store = await storeWith([
      baseEvent({ id: "1", trace_id: "trace-a", session_id: "sess-1" }),
      baseEvent({ id: "2", trace_id: "trace-a", session_id: "sess-2" }),
    ]);
    const result = await store.query(actor, { tenant_id: "tenant-1", session_id: "sess-2" });
    expect(result.items.map((item) => item.id)).toEqual(["2"]);
  });

  it("intersects when both filters are set", async () => {
    const store = await storeWith([
      baseEvent({ id: "1", trace_id: "trace-a", session_id: "sess-1" }),
      baseEvent({ id: "2", trace_id: "trace-a", session_id: "sess-2" }),
      baseEvent({ id: "3", trace_id: "trace-b", session_id: "sess-1" }),
    ]);
    const result = await store.query(actor, {
      tenant_id: "tenant-1",
      trace_id: "trace-a",
      session_id: "sess-1",
    });
    expect(result.items.map((item) => item.id)).toEqual(["1"]);
  });

  it("returns all tenant-visible events when neither filter is set", async () => {
    const store = await storeWith([
      baseEvent({ id: "1", trace_id: "trace-a", session_id: "sess-1" }),
      baseEvent({ id: "2", trace_id: "trace-b", session_id: "sess-2" }),
    ]);
    const result = await store.query(actor, { tenant_id: "tenant-1" });
    expect(result.items.map((item) => item.id).sort()).toEqual(["1", "2"]);
  });
});
