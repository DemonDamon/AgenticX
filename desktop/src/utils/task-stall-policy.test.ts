import { describe, expect, it } from "vitest";
import type { ParsedTodo } from "../components/TodoUpdateCard";
import { resolveStickyTodoDisplay, shouldSuppressStallDetection } from "./task-stall-policy";

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
