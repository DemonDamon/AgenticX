import { describe, expect, it } from "vitest";
import type { Message } from "../store";
import {
  budgetExceededInfoFromPayload,
  findBudgetExceededInMessages,
  parseBudgetExceededFromText,
} from "./budget-exceeded";
import { buildBudgetResumeDraft } from "./budget-resume-draft";
import {
  looksLikeUnfinishedAssistantBody,
  shouldShowBudgetIncompleteHint,
} from "./budget-incomplete-message";
import { shouldAllowStallAutoNudge } from "./task-stall-policy";

describe("budget-exceeded utils", () => {
  it("parses budget exceeded text", () => {
    const info = parseBudgetExceededFromText(
      "Token budget exceeded (507201/500000, source=session). Stopping to preserve results.",
    );
    expect(info).toEqual({ source: "session", current: 507201, maxAllowed: 500000 });
  });

  it("reads semantic payload fields", () => {
    const info = budgetExceededInfoFromPayload({
      budget_exceeded: true,
      budget_source: "session",
      current: 507201,
      max_allowed: 500000,
      detector: "token_budget",
    });
    expect(info?.current).toBe(507201);
  });

  it("finds budget exceeded in message history", () => {
    const messages: Message[] = [
      {
        id: "1",
        role: "tool",
        content: "Token budget exceeded (100/90, source=session). Stopping to preserve results.",
        noticeKind: "budget_exceeded",
        budgetCurrent: 100,
        budgetMax: 90,
        budgetSource: "session",
      },
    ];
    expect(findBudgetExceededInMessages(messages)?.current).toBe(100);
  });
});

describe("buildBudgetResumeDraft", () => {
  it("builds draft from goal, todo, and assistant summaries", () => {
    const messages: Message[] = [
      { id: "u1", role: "user", content: "安装 skill 到 Machi" },
      {
        id: "a1",
        role: "assistant",
        content: "已完成 4 个核心 skill 安装。",
      },
      {
        id: "t1",
        role: "tool",
        content: "🗂 任务清单更新\n[>] 补齐剩余空壳目录",
      },
    ];
    const draft = buildBudgetResumeDraft(messages);
    expect(draft).toContain("【原始目标】");
    expect(draft).toContain("安装 skill 到 Machi");
    expect(draft).toContain("【待办列表】");
    expect(draft).toContain("请基于以上信息继续未完成的工作");
  });

  it("truncates long assistant summaries", () => {
    const long = "x".repeat(900);
    const draft = buildBudgetResumeDraft([
      { id: "u1", role: "user", content: "goal" },
      { id: "a1", role: "assistant", content: long },
    ]);
    expect(draft.includes("x".repeat(601))).toBe(false);
  });
});

describe("budget incomplete hint", () => {
  it("detects unfinished trailing punctuation", () => {
    expect(looksLikeUnfinishedAssistantBody("团长，直接用 curl 下载安装：")).toBe(true);
    expect(looksLikeUnfinishedAssistantBody("任务已完成。")).toBe(false);
  });

  it("shows hint only for assistant before budget exceeded", () => {
    const messages: Message[] = [
      { id: "a1", role: "assistant", content: "先确认仓库还在：" },
      {
        id: "t1",
        role: "tool",
        content: "Token budget exceeded (100/90, source=session).",
        noticeKind: "budget_exceeded",
      },
    ];
    expect(shouldShowBudgetIncompleteHint(messages[0], messages, true)).toBe(true);
    expect(shouldShowBudgetIncompleteHint(messages[1], messages, true)).toBe(false);
  });
});

describe("shouldAllowStallAutoNudge", () => {
  it("blocks auto nudge when budget exceeded", () => {
    expect(shouldAllowStallAutoNudge("stall", "running", true)).toBe(false);
  });

  it("allows auto nudge for normal stall", () => {
    expect(shouldAllowStallAutoNudge("stall", "running", false)).toBe(true);
  });
});
