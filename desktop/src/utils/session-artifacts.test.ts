import { describe, expect, it } from "vitest";
import type { Message, SubAgent } from "../store";
import {
  artifactBaseName,
  collectSessionArtifactPaths,
  isInAppArtifactPreviewPath,
  isInAppHtmlPreviewPath,
  looksLikeDirectoryPath,
  pathToFileUrl,
} from "./session-artifacts";

function toolMsg(partial: Partial<Message> & Pick<Message, "id" | "content">): Message {
  return {
    role: "tool",
    timestamp: 1,
    ...partial,
  };
}

function assistantMsg(partial: Partial<Message> & Pick<Message, "id" | "content">): Message {
  return {
    role: "assistant",
    timestamp: 1,
    ...partial,
  };
}

describe("collectSessionArtifactPaths", () => {
  it("collects file_write path from toolArgs and OK: wrote body", () => {
    const messages: Message[] = [
      toolMsg({
        id: "t1",
        toolName: "file_write",
        toolArgs: { path: "/Users/damon/.agenticx/avatars/x/workspace/charts/a.svg" },
        content: "✅ file_write 结果: OK: wrote /Users/damon/.agenticx/avatars/x/workspace/charts/a.svg",
      }),
      toolMsg({
        id: "t2",
        toolName: "file_edit",
        toolArgs: { path: "/Users/damon/.agenticx/avatars/x/workspace/charts/b.mmd" },
        content: "OK: edited /Users/damon/.agenticx/avatars/x/workspace/charts/b.mmd (120 chars)",
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([
      "/Users/damon/.agenticx/avatars/x/workspace/charts/a.svg",
      "/Users/damon/.agenticx/avatars/x/workspace/charts/b.mmd",
    ]);
  });

  it("skips directory-only 保存路径 labels (join base, not an artifact row)", () => {
    const messages: Message[] = [
      assistantMsg({
        id: "a1",
        content: "保存路径：`/Users/damon/.agenticx/avatars/x/workspace/charts/`",
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([]);
  });

  it("joins markdown table filenames under 保存路径 directory", () => {
    const messages: Message[] = [
      assistantMsg({
        id: "a1",
        content: [
          "| 文件 | 大小 |",
          "| --- | --- |",
          "| A股科技股后续走势分析框架.mmd | 1.9 KB |",
          "| A股科技股三种情景对比.svg | 8.8 KB |",
          "",
          "保存路径：`/Users/damon/.agenticx/avatars/x/workspace/charts/`",
        ].join("\n"),
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([
      "/Users/damon/.agenticx/avatars/x/workspace/charts/A股科技股后续走势分析框架.mmd",
      "/Users/damon/.agenticx/avatars/x/workspace/charts/A股科技股三种情景对比.svg",
    ]);
  });

  it("collects absolute bash redirect targets", () => {
    const messages: Message[] = [
      toolMsg({
        id: "t1",
        toolName: "bash_exec",
        toolArgs: {
          command: "cat > /Users/damon/.agenticx/avatars/x/workspace/charts/c.svg <<'EOF'\n<svg/>\nEOF",
        },
        content: "✅ bash_exec 结果: ok",
      }),
    ];
    expect(collectSessionArtifactPaths(messages)).toEqual([
      "/Users/damon/.agenticx/avatars/x/workspace/charts/c.svg",
    ]);
  });

  it("merges sub-agent outputs and extra paths with dedupe", () => {
    const path = "/Users/damon/out/report.md";
    const messages: Message[] = [
      toolMsg({
        id: "t1",
        toolName: "file_write",
        toolArgs: { path },
        content: `OK: wrote ${path}`,
      }),
    ];
    const subAgents: SubAgent[] = [
      {
        id: "s1",
        name: "worker",
        role: "worker",
        status: "completed",
        task: "x",
        resultFile: path,
        outputFiles: ["/Users/damon/out/extra.csv"],
        events: [],
      },
    ];
    expect(collectSessionArtifactPaths(messages, subAgents, [path, "/tmp/pin.bin"])).toEqual([
      path,
      "/Users/damon/out/extra.csv",
      "/tmp/pin.bin",
    ]);
  });

  it("filters by ownerSessionId when provided", () => {
    const messages: Message[] = [
      toolMsg({
        id: "t1",
        ownerSessionId: "sess-a",
        toolName: "file_write",
        toolArgs: { path: "/tmp/a.txt" },
        content: "OK: wrote /tmp/a.txt",
      }),
      toolMsg({
        id: "t2",
        ownerSessionId: "sess-b",
        toolName: "file_write",
        toolArgs: { path: "/tmp/b.txt" },
        content: "OK: wrote /tmp/b.txt",
      }),
    ];
    expect(collectSessionArtifactPaths(messages, null, null, "sess-a")).toEqual(["/tmp/a.txt"]);
  });
});

describe("artifact helpers", () => {
  it("artifactBaseName", () => {
    expect(artifactBaseName("/a/b/c.svg")).toBe("c.svg");
    expect(artifactBaseName("/a/b/charts/")).toBe("charts");
  });

  it("looksLikeDirectoryPath", () => {
    expect(looksLikeDirectoryPath("/Users/x/charts/")).toBe(true);
    expect(looksLikeDirectoryPath("/Users/x/charts")).toBe(true);
    expect(looksLikeDirectoryPath("/Users/x/charts/a.svg")).toBe(false);
  });

  it("isInAppHtmlPreviewPath", () => {
    expect(isInAppHtmlPreviewPath("/tmp/report.html")).toBe(true);
    expect(isInAppHtmlPreviewPath("/tmp/Report.HTM")).toBe(true);
    expect(isInAppHtmlPreviewPath("/tmp/a.svg")).toBe(false);
  });

  it("isInAppArtifactPreviewPath", () => {
    expect(isInAppArtifactPreviewPath("/tmp/a.svg")).toBe(true);
    expect(isInAppArtifactPreviewPath("/tmp/a.mmd")).toBe(true);
    expect(isInAppArtifactPreviewPath("/tmp/a.pdf")).toBe(true);
    expect(isInAppArtifactPreviewPath("/tmp/a.docx")).toBe(true);
    expect(isInAppArtifactPreviewPath("/tmp/report.html")).toBe(false);
    expect(isInAppArtifactPreviewPath("/tmp/charts/")).toBe(false);
  });

  it("pathToFileUrl", () => {
    expect(pathToFileUrl("/Users/damon/a.html")).toBe("file:///Users/damon/a.html");
    expect(pathToFileUrl("C:/Users/damon/a.html")).toBe("file:///C:/Users/damon/a.html");
  });
});
