/**
 * Author: Damon Li
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GroupExpertActivity } from "../../utils/group-expert-activity";
import { GroupExpertActivityCard } from "./GroupExpertActivityCard";

const activity: GroupExpertActivity = {
  agentId: "researcher",
  avatarName: "调研",
  avatarUrl: "https://img.example/researcher.png",
  phase: "tool",
  summary: "正在使用网络检索",
  startedAt: 1_000,
  updatedAt: 13_000,
  toolSteps: [
    {
      callId: "c1",
      toolName: "web_search",
      phase: "done",
      updatedAt: 4_000,
      detail: "倒计时 gameState",
      output: "找到 3 条结果",
    },
    {
      callId: "c2",
      toolName: "file_read",
      phase: "calling",
      updatedAt: 13_000,
      detail: "fanshu_game.html",
    },
  ],
};

describe("GroupExpertActivityCard", () => {
  it("renders avatar, Chinese summary, and elapsed time", () => {
    const html = renderToStaticMarkup(
      <GroupExpertActivityCard activity={activity} now={13_000} />,
    );
    expect(html).toContain("https://img.example/researcher.png");
    expect(html).toContain("调研");
    expect(html).toContain("正在使用网络检索");
    expect(html).not.toContain("正在使用网络检索…");
    expect(html).toContain("agx-working-shimmer");
    expect(html).toContain("agx-status-shimmer");
    expect(html).toContain("agx-working-ellipsis");
    expect(html).not.toContain("animate-pulse");
    expect(html).toContain("12s");
    expect(html).not.toContain("is working...");
    expect(html).not.toContain("Answered");
    expect(html).not.toContain("Waiting on follow-up");
    expect(html).not.toContain("(pass)");
    expect(html).not.toContain("web_search");
    expect(html).not.toContain("arguments");
    expect(html).not.toContain("result");
  });

  it("hides tool steps until expanded", () => {
    const collapsed = renderToStaticMarkup(
      <GroupExpertActivityCard activity={activity} now={13_000} />,
    );
    expect(collapsed).toContain("正在使用网络检索");
    expect(collapsed).not.toContain("文件读取");
    expect(collapsed).not.toContain("已完成");
    expect(collapsed).not.toContain("进行中");
    expect(collapsed).not.toContain("fanshu_game.html");
    expect(collapsed).not.toContain("找到 3 条结果");

    const expanded = renderToStaticMarkup(
      <GroupExpertActivityCard activity={activity} now={13_000} defaultExpanded />,
    );
    expect(expanded).toContain("网络检索");
    expect(expanded).toContain("文件读取");
    expect(expanded).toContain("已完成");
    expect(expanded).toContain("进行中");
    expect(expanded).toContain("倒计时 gameState");
    expect(expanded).toContain("找到 3 条结果");
    expect(expanded).toContain("fanshu_game.html");
    expect(expanded).toContain("agx-working-shimmer");
    expect(expanded).not.toContain("web_search");
    expect(expanded).not.toContain("file_read");
  });

  it("caps an expanded tool list at the activity's 6 steps", () => {
    const many: GroupExpertActivity = {
      ...activity,
      toolSteps: Array.from({ length: 6 }, (_, i) => ({
        callId: `c${i}`,
        toolName: "bash_exec",
        phase: i === 5 ? "calling" : "done",
        updatedAt: 2_000 + i,
      })),
    };
    const html = renderToStaticMarkup(
      <GroupExpertActivityCard activity={many} now={13_000} defaultExpanded />,
    );
    expect(html.split("终端").length - 1).toBe(6);
  });

  it("uses an amber waiting icon instead of typing dots", () => {
    const html = renderToStaticMarkup(
      <GroupExpertActivityCard
        activity={{
          ...activity,
          phase: "waiting",
          summary: "等待你的确认…",
          toolSteps: [],
        }}
        now={13_000}
      />,
    );
    expect(html).toContain("等待你的确认…");
    expect(html).toContain("text-amber-500");
    expect(html).not.toContain("animate-pulse");
    expect(html).not.toContain("agx-working-ellipsis");
    expect(html).not.toContain("agx-working-shimmer");
  });

  it("keeps only the typographic working ellipsis, not a trailing ellipsis on the copy", () => {
    const html = renderToStaticMarkup(
      <GroupExpertActivityCard
        activity={{
          ...activity,
          summary: "已完成文件读取，继续处理中…",
        }}
        now={13_000}
      />,
    );
    expect(html).toContain("已完成文件读取，继续处理中");
    expect(html).not.toContain("继续处理中…");
    expect(html).not.toContain("继续处理中...");
    expect(html).toContain("agx-working-shimmer");
    expect(html).toContain("agx-status-shimmer");
    expect(html).toContain("agx-working-ellipsis");
    expect(html).not.toContain("animate-pulse");
    expect(html).toContain("12s");
    expect(html).toContain("agx-group-activity-status");
    expect(html).toContain("w-fit");
    expect(html).not.toMatch(/agx-group-activity-status[^"]*flex-1/);
  });
});
