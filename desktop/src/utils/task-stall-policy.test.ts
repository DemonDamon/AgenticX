import { describe, expect, it } from "vitest";
import type { ParsedTodo } from "../components/TodoUpdateCard";
import type { Message } from "../store";
import {
  messageLooksLikeAssistantFinal,
  resolveStickyTodoDisplay,
  shouldSuppressStallDetection,
} from "./task-stall-policy";

const sampleTodo: ParsedTodo = {
  items: [{ status: "in_progress", content: "定位代码模块" }],
  completed: 0,
  total: 1,
};

describe("resolveStickyTodoDisplay", () => {
  it("keeps in_progress while agent is active", () => {
    const out = resolveStickyTodoDisplay(sampleTodo, "active", "running");
    expect(out.items[0]?.status).toBe("in_progress");
    expect(out.completed).toBe(0);
  });

  it("marks stale in_progress completed when run ended idle", () => {
    const out = resolveStickyTodoDisplay(sampleTodo, "idle", "idle");
    expect(out.items[0]?.status).toBe("completed");
    expect(out.completed).toBe(1);
  });

  it("marks in_progress pending when interrupted", () => {
    const out = resolveStickyTodoDisplay(sampleTodo, "idle", "interrupted");
    expect(out.items[0]?.status).toBe("pending");
    expect(out.completed).toBe(0);
  });

  it("promotes residual pending to completed when promotePending is set on idle", () => {
    const todo: ParsedTodo = {
      items: [
        { status: "completed", content: "step 1" },
        { status: "pending", content: "step 2" },
      ],
      completed: 1,
      total: 2,
    };
    const out = resolveStickyTodoDisplay(todo, "idle", "idle", { promotePending: true });
    expect(out.items[1]?.status).toBe("completed");
    expect(out.completed).toBe(2);
  });

  it("does not promote pending when promotePending is set but state is interrupted", () => {
    const todo: ParsedTodo = {
      items: [
        { status: "completed", content: "step 1" },
        { status: "pending", content: "step 2" },
      ],
      completed: 1,
      total: 2,
    };
    const out = resolveStickyTodoDisplay(todo, "idle", "interrupted", { promotePending: true });
    expect(out.items[1]?.status).toBe("pending");
    expect(out.completed).toBe(1);
  });
});

describe("shouldSuppressStallDetection", () => {
  it("returns true when run guard matches session", () => {
    expect(shouldSuppressStallDetection("sess-1", "sess-1")).toBe(true);
  });

  it("returns true when user explicitly stopped the session", () => {
    expect(shouldSuppressStallDetection("", "sess-1", true)).toBe(true);
  });

  it("returns false when guard is empty or session differs", () => {
    expect(shouldSuppressStallDetection("", "sess-1")).toBe(false);
    expect(shouldSuppressStallDetection("sess-1", "sess-2")).toBe(false);
  });
});

describe("messageLooksLikeAssistantFinal", () => {
  const base: Message = {
    id: "a1",
    role: "assistant",
    content: "done",
    timestamp: Date.now(),
  };

  it("treats colon-ending replies as unfinished", () => {
    expect(
      messageLooksLikeAssistantFinal({ ...base, content: "继续安装 diagnose:" }),
    ).toBe(false);
    expect(
      messageLooksLikeAssistantFinal({ ...base, content: "下一步：" }),
    ).toBe(false);
  });

  it("accepts complete assistant replies", () => {
    expect(
      messageLooksLikeAssistantFinal({ ...base, content: "安装已完成。" }),
    ).toBe(true);
  });
});
