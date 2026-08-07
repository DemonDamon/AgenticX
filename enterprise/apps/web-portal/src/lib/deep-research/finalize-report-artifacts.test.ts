import { describe, expect, it } from "vitest";
import { createMemoryArtifactStore } from "./artifact-store";
import {
  finalizeReportArtifacts,
  safeFilename,
} from "./finalize-report-artifacts";

describe("safeFilename", () => {
  it("strips path separators and quotes", () => {
    const name = safeFilename('A/B"C\n', "html");
    expect(name.endsWith(".html")).toBe(true);
    expect(name).not.toContain("/");
    expect(name).not.toContain('"');
    expect(name).not.toContain("\n");
  });

  it("falls back when empty", () => {
    expect(safeFilename("   ", "md")).toBe("research-report.md");
  });
});

describe("finalizeReportArtifacts", () => {
  it("writes report.html only (no report.md duplicate)", async () => {
    const store = createMemoryArtifactStore();
    const events: Array<{ type: string; path?: string }> = [];
    const written = await finalizeReportArtifacts({
      artifactStore: store,
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      runId: "run-1",
      topic: "主题",
      outline: {
        title: "报告标题",
        sections: [
          { id: "s1", title: "核心结论", brief: "b", citationIndexes: [1], format: "prose" },
        ],
      },
      markdown: "# 报告标题\n\n结论 [1]\n",
      citations: [
        { index: 1, title: "A", url: "https://a.com", snippet: "s" },
      ],
      artifactsWritten: 0,
      enqueueEvent: (e) => events.push(e),
    });
    expect(written).toBe(1);
    const list = await store.listByRun("t1", "u1", "run-1");
    expect(list.map((a) => a.path)).toEqual(["research/run-1/report.html"]);
    expect(list.some((a) => a.path.endsWith("report.md"))).toBe(false);
    const html = list.find((a) => a.path.endsWith("report.html"));
    expect(html?.content.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html?.content).toContain("ref-1");
    expect(events.filter((e) => e.type === "artifact")).toHaveLength(1);
  });

  it("still writes report.html when artifact quota is already full and format is html", async () => {
    const store = createMemoryArtifactStore();
    const written = await finalizeReportArtifacts({
      artifactStore: store,
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      runId: "run-full",
      topic: "主题",
      outline: {
        title: "报告标题",
        sections: [
          { id: "s1", title: "核心结论", brief: "b", citationIndexes: [], format: "prose" },
        ],
      },
      markdown: "# 报告\n\n结论\n",
      citations: [],
      artifactsWritten: 40,
      deliveryPrefs: { shapes: ["structured"], format: "html" },
      enqueueEvent: () => {},
    });
    expect(written).toBe(41);
    const list = await store.listByRun("t1", "u1", "run-full");
    expect(list.some((a) => a.path.endsWith("report.html"))).toBe(true);
  });

  it("writes report.doc when format is docx", async () => {
    const store = createMemoryArtifactStore();
    const events: Array<{ type: string; path?: string }> = [];
    const written = await finalizeReportArtifacts({
      artifactStore: store,
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      runId: "run-doc",
      topic: "竞品调研",
      outline: {
        title: "竞品调研",
        sections: [
          { id: "s1", title: "核心结论", brief: "b", citationIndexes: [1], format: "prose" },
        ],
      },
      markdown: "# 竞品调研\n\n结论 [1]\n",
      citations: [
        { index: 1, title: "A", url: "https://a.com", snippet: "s" },
      ],
      artifactsWritten: 0,
      deliveryPrefs: { shapes: ["structured"], format: "docx" },
      enqueueEvent: (e) => events.push(e),
    });
    expect(written).toBeGreaterThanOrEqual(1);
    const list = await store.listByRun("t1", "u1", "run-doc");
    const doc = list.find((a) => a.path.endsWith("report.doc"));
    expect(doc).toBeTruthy();
    expect(doc?.mimeType).toBe("application/vnd.ms-word");
    expect(doc?.title).toBe("竞品调研.doc");
    expect(doc?.content).toContain("xmlns:w=");
    expect(doc?.content).toContain("WordDocument");
    expect(
      events.some((e) => e.type === "artifact" && e.path?.endsWith("report.doc")),
    ).toBe(true);
  });

  it("still writes report.doc when artifact quota is already full and format is docx", async () => {
    const store = createMemoryArtifactStore();
    const written = await finalizeReportArtifacts({
      artifactStore: store,
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      runId: "run-doc-full",
      topic: "主题",
      outline: {
        title: "报告标题",
        sections: [
          { id: "s1", title: "核心结论", brief: "b", citationIndexes: [], format: "prose" },
        ],
      },
      markdown: "# 报告\n\n结论\n",
      citations: [],
      artifactsWritten: 40,
      deliveryPrefs: { shapes: ["structured"], format: "docx" },
      enqueueEvent: () => {},
    });
    expect(written).toBeGreaterThanOrEqual(41);
    const list = await store.listByRun("t1", "u1", "run-doc-full");
    expect(list.some((a) => a.path.endsWith("report.doc"))).toBe(true);
  });
});
