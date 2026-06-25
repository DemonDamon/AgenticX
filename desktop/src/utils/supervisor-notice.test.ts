import { describe, expect, it } from "vitest";
import type { Message } from "../store";
import {
  dedupeSupervisorNotices,
  isSupervisorDoneNotice,
  isSupervisorFailNotice,
  supervisorNoticeDisplayText,
} from "./supervisor-notice";

const done = (id: string): Message => ({
  id,
  role: "tool",
  content: "✅ 任务已完成（5/5）",
  metadata: { kind: "unattended_done", source: "supervisor" },
});

const fail = (id: string): Message => ({
  id,
  role: "tool",
  content: "⛔ 无人值守已停止：已连续运行约 6 小时，达到自动运行时长上限",
  metadata: { kind: "unattended_failed", source: "supervisor", limit_code: "wall_clock" },
});

describe("supervisor-notice", () => {
  it("detects done and fail notices", () => {
    expect(isSupervisorDoneNotice(done("a"))).toBe(true);
    expect(isSupervisorFailNotice(fail("b"))).toBe(true);
  });

  it("strips leading emoji for display", () => {
    expect(supervisorNoticeDisplayText("✅ 任务已完成（5/5）")).toBe("任务已完成（5/5）");
    expect(supervisorNoticeDisplayText("⛔ 无人值守已停止：test")).toBe("无人值守已停止：test");
  });

  it("keeps only the last duplicate done/fail rows", () => {
    const msgs = [done("1"), done("2"), fail("3"), done("4"), fail("5"), { id: "u", role: "user", content: "hi" }];
    const out = dedupeSupervisorNotices(msgs);
    expect(out.map((m) => m.id)).toEqual(["4", "5", "u"]);
  });
});
