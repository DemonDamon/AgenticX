import { describe, expect, it } from "vitest";
import type { ParsedTodo } from "../components/TodoUpdateCard";
import type { Message } from "../store";
import {
  isTodoSnapshotSuperseded,
  messageLooksLikeAssistantFinal,
  resolveStickyTodoDisplay,
  shouldResetStallDetectorsOnSessionSwitch,
  shouldSuppressStallDetection,
} from "./task-stall-policy";

const sampleTodo: ParsedTodo = {
  items: [{ status: "in_progress", content: "定位代码模块" }],
  completed: 0,
  total: 1,
};

const msg = (partial: Partial<Message> & Pick<Message, "id" | "role">): Message => ({
  content: "",
  timestamp: Date.now(),
  ...partial,
});

describe("isTodoSnapshotSuperseded", () => {
  it("returns true when a user message follows the todo snapshot", () => {
    const messages: Message[] = [
      msg({ id: "t1", role: "tool", toolName: "todo_write", content: "[ ] task" }),
      msg({ id: "a1", role: "assistant", content: "working" }),
      msg({ id: "u1", role: "user", content: "新问题" }),
    ];
    expect(isTodoSnapshotSuperseded(messages, 0)).toBe(true);
  });

  it("returns false when only tool and assistant messages follow the todo snapshot", () => {
    const messages: Message[] = [
      msg({ id: "t1", role: "tool", toolName: "todo_write", content: "[ ] task" }),
      msg({ id: "t2", role: "tool", toolName: "web_search", content: "results" }),
      msg({ id: "a1", role: "assistant", content: "done" }),
    ];
    expect(isTodoSnapshotSuperseded(messages, 0)).toBe(false);
  });

  it("returns false for the latest todo snapshot with no user messages after it", () => {
    const messages: Message[] = [
      msg({ id: "t0", role: "tool", toolName: "todo_write", content: "[ ] old" }),
      msg({ id: "u0", role: "user", content: "start" }),
      msg({ id: "t1", role: "tool", toolName: "todo_write", content: "[ ] new" }),
      msg({ id: "a1", role: "assistant", content: "working" }),
    ];
    expect(isTodoSnapshotSuperseded(messages, 2)).toBe(false);
  });
});

describe("resolveStickyTodoDisplay", () => {
  it("keeps in_progress while agent is active", () => {
    const out = resolveStickyTodoDisplay(sampleTodo, "active", "running");
    expect(out.items[0]?.status).toBe("in_progress");
    expect(out.completed).toBe(0);
  });

  it("falls back in_progress to pending when idle without promotePending evidence", () => {
    const out = resolveStickyTodoDisplay(sampleTodo, "idle", "idle");
    expect(out.items[0]?.status).toBe("pending");
    expect(out.completed).toBe(0);
  });

  it("marks in_progress completed when idle with promotePending evidence", () => {
    const out = resolveStickyTodoDisplay(sampleTodo, "idle", "idle", { promotePending: true });
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

describe("shouldResetStallDetectorsOnSessionSwitch", () => {
  it("resets when switching to a different session", () => {
    expect(shouldResetStallDetectorsOnSessionSwitch("sess-b", "sess-a")).toBe(true);
  });

  it("resets on first entry (no prior session)", () => {
    expect(shouldResetStallDetectorsOnSessionSwitch("", "sess-a")).toBe(true);
    expect(shouldResetStallDetectorsOnSessionSwitch(undefined, "sess-a")).toBe(true);
  });

  it("does NOT reset when the displayed session is unchanged", () => {
    expect(shouldResetStallDetectorsOnSessionSwitch("sess-a", "sess-a")).toBe(false);
    expect(shouldResetStallDetectorsOnSessionSwitch("  sess-a  ", "sess-a")).toBe(false);
  });

  it("does NOT reset when there is no next session", () => {
    expect(shouldResetStallDetectorsOnSessionSwitch("sess-a", "")).toBe(false);
    expect(shouldResetStallDetectorsOnSessionSwitch("sess-a", undefined)).toBe(false);
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
