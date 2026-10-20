import { describe, expect, it } from "vitest";
import { createMemoryArtifactStore } from "./artifact-store";
import { CitationRegistry } from "./registry";
import {
  decodeReportCheckpoint,
  encodeReportCheckpoint,
  loadReportCheckpoint,
  REPORT_CHECKPOINT_MIME,
  saveReportCheckpoint,
  type ReportCheckpoint,
} from "./report-checkpoint";

const section = {
  id: "s1",
  title: "已完成",
  brief: "概览",
  citationIndexes: [7],
  format: "prose" as const,
};

const saved: ReportCheckpoint = {
  version: 1,
  sourceRunId: "old",
  nextRunId: "new",
  topic: "主题",
  messages: [{ role: "user", content: "用三句话介绍主题，不要表格" }],
  writingRequirements: "用三句话介绍主题，不要表格",
  model: "m",
  provider: "p",
  outline: { title: "报告", sections: [section] },
  completed: [{ section, body: "保留正文 [7]" }],
  sectionEvidence: ["原始证据"],
  citations: [{ index: 7, title: "附件", url: "https://example.com/src", snippet: "摘要" }],
  deliveryPrefs: { format: "md", shapes: ["structured"] },
  stats: { queriesPlanned: 2, urlsDiscovered: 4, sourcesSelected: 3, pagesFetched: 2 },
  createdAt: "2026-10-20T00:00:00.000Z",
};

describe("report checkpoint persistence", () => {
  it("round trips completed chapters, citations, and original writing input", async () => {
    const store = createMemoryArtifactStore();
    const record = await saveReportCheckpoint(
      store,
      { tenantId: "t", userId: "u", sessionId: "s" },
      saved,
    );
    expect(record.mimeType).toBe(REPORT_CHECKPOINT_MIME);
    expect(record.path).toBe("research/old/report-checkpoint.gz");
    const decoded = await loadReportCheckpoint(store, { tenantId: "t", userId: "u" }, "old");
    expect(decoded).toEqual(saved);
    expect(decoded).not.toHaveProperty("attachmentRoute");
    const registry = new CitationRegistry(decoded!.citations);
    expect(registry.list()).toEqual(saved.citations);
    expect(registry.add({ title: "新来源", url: "https://example.com/next", snippet: "内容" }).index).toBe(8);
  });

  it("fails when another user reads the checkpoint", async () => {
    const store = createMemoryArtifactStore();
    await saveReportCheckpoint(store, { tenantId: "t", userId: "owner", sessionId: "s" }, saved);
    await expect(loadReportCheckpoint(store, { tenantId: "t", userId: "other" }, "old")).resolves.toBeNull();
    await expect(loadReportCheckpoint(store, { tenantId: "other", userId: "owner" }, "old")).resolves.toBeNull();
  });

  it("drops attachment routing if it was present in stored json", async () => {
    const store = createMemoryArtifactStore();
    const record = await store.write({
      tenantId: "t",
      userId: "u",
      sessionId: "s",
      runId: "old",
      path: "research/old/report-checkpoint.gz",
      title: "checkpoint",
      mimeType: REPORT_CHECKPOINT_MIME,
      content: encodeReportCheckpoint({ ...saved, attachmentRoute: "public-override" } as ReportCheckpoint),
    });
    const decoded = decodeReportCheckpoint(record, "old");
    expect(decoded).not.toHaveProperty("attachmentRoute");
    expect(decoded.writingRequirements).toBe(saved.writingRequirements);
  });

  it("rejects a checkpoint for a different run and a truncated payload", async () => {
    const store = createMemoryArtifactStore();
    const record = await saveReportCheckpoint(store, { tenantId: "t", userId: "u", sessionId: "s" }, saved);
    expect(() => decodeReportCheckpoint(record, "other-run")).toThrow("invalid research checkpoint");
    expect(() => decodeReportCheckpoint({ ...record, content: "truncated" }, "old")).toThrow();
  });

  it("rejects oversize rather than storing a truncated recovery state", () => {
    expect(() =>
      encodeReportCheckpoint({ ...saved, sectionEvidence: ["x".repeat(4 * 1024 * 1024)] }),
    ).toThrow("too large");
  });

  it("rejects completed chapters that do not match the outline", async () => {
    const store = createMemoryArtifactStore();
    const record = await store.write({
      tenantId: "t",
      userId: "u",
      sessionId: "s",
      runId: "old",
      path: "research/old/report-checkpoint.gz",
      title: "checkpoint",
      mimeType: REPORT_CHECKPOINT_MIME,
      content: encodeReportCheckpoint({
        ...saved,
        completed: [{ section: { ...section, id: "wrong" }, body: "text" }],
      }),
    });
    expect(() => decodeReportCheckpoint(record, "old")).toThrow("invalid");
  });
});
