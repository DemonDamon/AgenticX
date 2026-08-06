import { describe, expect, it, vi } from "vitest";
import { createMemoryArtifactStore } from "./artifact-store";
import {
  archivePage,
  MAX_ARCHIVE_CHARS,
  MAX_ARCHIVED_PAGES_PER_RUN,
  pageArchiveFileName,
  pageArchiveKey,
  pageArchivePath,
  pageArchiveSlug,
} from "./page-archive";

describe("pageArchiveKey / pageArchivePath", () => {
  it("collapses utm and trailing-slash variants to the same key", () => {
    const a = pageArchiveKey("https://example.com/post?utm_source=x");
    const b = pageArchiveKey("https://example.com/post/");
    const c = pageArchiveKey("https://example.com/post");
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("builds research/<runId>/pages/<slug>_<16hex>.md", () => {
    const path = pageArchivePath("r1", "https://example.com/a", "DeepSeek V4 解读");
    expect(path).toMatch(/^research\/r1\/pages\/DeepSeek-V4-解读_[0-9a-f]{16}\.md$/);
  });

  it("slug falls back to host when title empty", () => {
    expect(pageArchiveSlug("", "https://www.51cto.com/article/123.html")).toContain("51cto");
    expect(pageArchiveFileName("", "https://example.com/x")).toMatch(
      /^example-com-x_[0-9a-f]{16}\.md$/,
    );
  });
});

describe("archivePage", () => {
  it("writes front-matter markdown under pages/", async () => {
    const store = createMemoryArtifactStore();
    const ok = await archivePage({
      artifactStore: store,
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      runId: "run1",
      url: "https://example.com/doc",
      title: "文档标题",
      backend: "jina",
      text: "正文内容段落",
      archivedSoFar: 0,
    });
    expect(ok).toBe(true);
    const rows = await store.listByRun("t1", "u1", "run1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.path).toMatch(/^research\/run1\/pages\/文档标题_[0-9a-f]{16}\.md$/);
    expect(rows[0]?.title).toBe("文档标题");
    expect(rows[0]?.content).toContain("url: https://example.com/doc");
    expect(rows[0]?.content).toContain("backend: jina");
    expect(rows[0]?.content).toContain("正文内容段落");
  });

  it("returns false and skips write when quota exceeded", async () => {
    const store = createMemoryArtifactStore();
    const write = vi.spyOn(store, "write");
    const ok = await archivePage({
      artifactStore: store,
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      runId: "run1",
      url: "https://example.com/doc",
      title: "t",
      backend: "native",
      text: "body",
      archivedSoFar: MAX_ARCHIVED_PAGES_PER_RUN,
    });
    expect(ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("truncates body beyond MAX_ARCHIVE_CHARS", async () => {
    const store = createMemoryArtifactStore();
    const long = "字".repeat(MAX_ARCHIVE_CHARS + 200);
    await archivePage({
      artifactStore: store,
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      runId: "run1",
      url: "https://example.com/long",
      title: "长文",
      backend: "native",
      text: long,
      archivedSoFar: 0,
    });
    const rows = await store.listByRun("t1", "u1", "run1");
    const body = rows[0]?.content.split("---\n\n")[1] ?? "";
    expect(body.length).toBeLessThanOrEqual(MAX_ARCHIVE_CHARS + 5);
    expect(body.trimEnd().endsWith("…")).toBe(true);
  });

  it("returns false without throwing when write throws", async () => {
    const store = createMemoryArtifactStore();
    vi.spyOn(store, "write").mockRejectedValue(new Error("disk full"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      archivePage({
        artifactStore: store,
        tenantId: "t1",
        userId: "u1",
        sessionId: "s1",
        runId: "run1",
        url: "https://example.com/x",
        title: "t",
        backend: "native",
        text: "body",
        archivedSoFar: 0,
      }),
    ).resolves.toBe(false);
    warn.mockRestore();
  });
});
