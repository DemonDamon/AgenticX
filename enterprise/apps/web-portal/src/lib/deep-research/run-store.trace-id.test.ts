import { describe, expect, it } from "vitest";
import { createMemoryRunStore } from "./run-store";

describe("run-store traceId", () => {
  it("persists and returns traceId on create/get", async () => {
    const store = createMemoryRunStore();
    await store.create({
      runId: "01JZRUNTRACEID000000000001",
      tenantId: "01JZTENANT000000000000001",
      userId: "01JZUSER00000000000000001",
      sessionId: "01JZSESSION00000000000001",
      topic: "topic",
      traceId: "01JZTRACEID000000000000001",
    });
    const row = await store.get(
      "01JZTENANT000000000000001",
      "01JZUSER00000000000000001",
      "01JZRUNTRACEID000000000001",
    );
    expect(row?.traceId).toBe("01JZTRACEID000000000000001");
  });

  it("allows create without traceId", async () => {
    const store = createMemoryRunStore();
    await store.create({
      runId: "01JZRUNTRACEID000000000002",
      tenantId: "01JZTENANT000000000000001",
      userId: "01JZUSER00000000000000001",
      sessionId: "01JZSESSION00000000000001",
      topic: "topic",
    });
    const row = await store.get(
      "01JZTENANT000000000000001",
      "01JZUSER00000000000000001",
      "01JZRUNTRACEID000000000002",
    );
    expect(row?.traceId).toBeUndefined();
  });
});
