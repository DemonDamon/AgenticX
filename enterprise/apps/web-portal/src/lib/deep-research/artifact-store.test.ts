import { describe, expect, it } from "vitest";
import {
  createMemoryArtifactStore,
  MAX_ARTIFACT_BYTES,
} from "./artifact-store";

describe("memory artifact store", () => {
  it("MAX_ARTIFACT_BYTES exceeds MySQL TEXT capacity, so the DB column must be MEDIUMTEXT", () => {
    const MYSQL_TEXT_MAX = 65535;
    expect(MAX_ARTIFACT_BYTES).toBeGreaterThan(MYSQL_TEXT_MAX);
  });

  it("keeps content within budget instead of failing when oversized", async () => {
    const store = createMemoryArtifactStore();
    const huge = "字".repeat(400_000); // 3 bytes/char in UTF-8 → 约 1.2MB
    const record = await store.write({
      tenantId: "t",
      userId: "u",
      sessionId: "s",
      runId: "r",
      path: "research/r/report.html",
      title: "t.html",
      kind: "report",
      mimeType: "text/html",
      content: huge,
    });
    expect(record.byteSize).toBeLessThanOrEqual(MAX_ARTIFACT_BYTES);
  });

  it("upserts same session path", async () => {
    const store = createMemoryArtifactStore();
    const first = await store.write({
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      runId: "r1",
      path: "research/r1/lanes/q1/memo.md",
      title: "memo",
      kind: "memo",
      content: "v1",
    });
    const second = await store.write({
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      runId: "r1",
      path: "research/r1/lanes/q1/memo.md",
      title: "memo2",
      kind: "memo",
      content: "v2",
    });
    expect(second.id).toBe(first.id);
    expect(second.content).toBe("v2");
    const list = await store.listBySession("t1", "u1", "s1");
    expect(list).toHaveLength(1);
  });

  it("denies cross-user get", async () => {
    const store = createMemoryArtifactStore();
    const row = await store.write({
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      runId: "r1",
      path: "research/r1/final-report.md",
      title: "report",
      kind: "report",
      content: "body",
    });
    expect(row.content).toBe("body");
    expect(await store.listBySession("t1", "u1", "s1")).toHaveLength(1);
    expect(await store.get("t1", "u2", row.id)).toBeNull();
    const mine = await store.get("t1", "u1", row.id);
    expect(mine).not.toBeNull();
    expect(mine?.content).toBe("body");
  });
});
