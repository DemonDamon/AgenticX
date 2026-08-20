import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRUNE_NOTICE_TEXT,
  buildCompactionEventNotice,
  buildCompactionNoticeText,
  buildPruneNoticeText,
  isPruneOnlyCompaction,
  parseContextNotice,
} from "./context-notice";

/** compactor 剪枝独自解除压力时返回的说明，见 agenticx/runtime/compactor.py prune_only_summary。 */
const PRUNE_SUMMARY = "剪除了 3 条过大的工具结果（约 24000 字符），未做摘要。";

describe("compaction event notices", () => {
  it("keeps the summary wording when history was really summarized", () => {
    expect(buildCompactionEventNotice(13, false, "摘要正文")).toEqual({
      text: "已压缩 13 条较早历史，任务继续。",
      noticeKind: "compaction_proactive",
    });
    expect(buildCompactionEventNotice(5, true, "摘要正文")).toEqual({
      text: "上下文接近上限，已压缩 5 条历史，任务继续。",
      noticeKind: "compaction_reactive",
    });
  });

  it("does not claim a summary when only tool results were pruned", () => {
    // 剪枝时消息还在原位、没有摘要。走摘要文案会渲染成"已压缩 0 条较早历史"。
    const notice = buildCompactionEventNotice(0, false, PRUNE_SUMMARY);
    expect(notice).toEqual({ text: PRUNE_SUMMARY, noticeKind: "compaction_prune" });
    expect(notice.text).not.toContain("已压缩 0");
    expect(buildCompactionNoticeText(0, false)).toContain("已压缩 0");
  });

  it("uses the prune fallback when the runtime sent no summary", () => {
    expect(buildCompactionEventNotice(0, true, "")).toEqual({
      text: DEFAULT_PRUNE_NOTICE_TEXT,
      noticeKind: "compaction_prune",
    });
    expect(buildPruneNoticeText("   ")).toBe(DEFAULT_PRUNE_NOTICE_TEXT);
    // 兜底文案含"任务继续"却不含"已压缩"，否则会被文本识别归到摘要那一类。
    expect(DEFAULT_PRUNE_NOTICE_TEXT).not.toContain("已压缩");
  });

  it("treats a zero compacted_count as prune-only", () => {
    expect(isPruneOnlyCompaction(0)).toBe(true);
    expect(isPruneOnlyCompaction(7)).toBe(false);
  });
});

describe("parseContextNotice", () => {
  const row = (content: string) => ({
    role: "tool" as const,
    content,
    toolName: undefined,
    toolCallId: undefined,
    noticeKind: undefined,
  });

  it("recognises prune notices from text on legacy rows without metadata", () => {
    expect(parseContextNotice(row(PRUNE_SUMMARY))?.kind).toBe("compaction_prune");
    expect(parseContextNotice(row(DEFAULT_PRUNE_NOTICE_TEXT))?.kind).toBe("compaction_prune");
  });

  it("still recognises the two summary notices", () => {
    expect(parseContextNotice(row(buildCompactionNoticeText(9, false)))?.kind).toBe(
      "compaction_proactive",
    );
    expect(parseContextNotice(row(buildCompactionNoticeText(9, true)))?.kind).toBe(
      "compaction_reactive",
    );
  });
});

describe("mapLoadedSessionMessage", () => {
  it("restores the prune notice kind from persisted metadata across a reload", async () => {
    const { mapLoadedSessionMessage } = await import("./session-message-map");
    const mapped = mapLoadedSessionMessage(
      {
        role: "tool",
        content: PRUNE_SUMMARY,
        metadata: { kind: "compaction_prune", pruned_only: true, source: "runtime" },
      } as never,
      "sid",
      0,
    );
    expect(mapped.noticeKind).toBe("compaction_prune");
    expect(parseContextNotice(mapped)?.kind).toBe("compaction_prune");
  });
});
