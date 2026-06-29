import { describe, expect, it } from "vitest";
import type { ParsedTodo } from "../components/TodoUpdateCard";
import type { Message } from "../store";
import {
  CHANNEL_C_GRACE_MS,
  isFutileResume,
  isTodoSnapshotSuperseded,
  lastTurnHasCompletedAssistantReply,
  messageLooksLikeAssistantFinal,
  resolveStickyTodoDisplay,
  sessionMessagesHydrated,
  shouldAllowStallAutoNudge,
  shouldResetStallDetectorsOnSessionSwitch,
  shouldSuppressStallDetection,
  shouldTriggerIncompleteEndStall,
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

describe("lastTurnHasCompletedAssistantReply", () => {
  it("returns true when assistant reply exists before a trailing tool message", () => {
    const messages: Message[] = [
      msg({ id: "u1", role: "user", content: "查知识库" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "费马大定理的核心是：没有正整数解满足 x^n+y^n=z^n（n>2）。",
      }),
      msg({ id: "t1", role: "tool", toolName: "knowledge_search", content: "hits" }),
    ];
    expect(lastTurnHasCompletedAssistantReply(messages)).toBe(true);
  });

  it("counts colon-ending assistant body as completed for the last turn", () => {
    const messages: Message[] = [
      msg({ id: "u1", role: "user", content: "说明" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "上一次任务的未完成项我已检索确认，现在同步更新状态：",
      }),
    ];
    expect(lastTurnHasCompletedAssistantReply(messages)).toBe(true);
  });

  it("returns false when only reasoning without response body", () => {
    const messages: Message[] = [
      msg({ id: "u1", role: "user", content: "问题" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "<think>思考中</think>",
      }),
    ];
    expect(lastTurnHasCompletedAssistantReply(messages)).toBe(false);
  });

  it("ignores interrupted placeholder assistant rows", () => {
    const messages: Message[] = [
      msg({ id: "u1", role: "user", content: "问题" }),
      msg({ id: "a1", role: "assistant", content: "（已中断）" }),
    ];
    expect(lastTurnHasCompletedAssistantReply(messages)).toBe(false);
  });
});

describe("shouldTriggerIncompleteEndStall", () => {
  const completedWithToolTail: Message[] = [
    msg({ id: "u1", role: "user", content: "费马大定理" }),
    msg({ id: "a1", role: "assistant", content: "通俗解释如下：……" }),
    msg({ id: "t1", role: "tool", toolName: "knowledge_search", content: "[]" }),
  ];

  it("does not stall idle session when last turn already has assistant body", () => {
    expect(
      shouldTriggerIncompleteEndStall("idle", false, completedWithToolTail, CHANNEL_C_GRACE_MS),
    ).toBe(false);
  });

  it("stalls idle session when last turn has no assistant body after grace", () => {
    const messages: Message[] = [
      msg({ id: "u1", role: "user", content: "问题" }),
      msg({ id: "t1", role: "tool", toolName: "knowledge_search", content: "[]" }),
    ];
    expect(shouldTriggerIncompleteEndStall("idle", false, messages, CHANNEL_C_GRACE_MS)).toBe(
      true,
    );
  });

  it("does not stall before channel C grace elapses", () => {
    expect(
      shouldTriggerIncompleteEndStall("idle", false, completedWithToolTail, CHANNEL_C_GRACE_MS - 1),
    ).toBe(false);
  });

  it("does not stall while SSE is active", () => {
    expect(
      shouldTriggerIncompleteEndStall("idle", true, completedWithToolTail, CHANNEL_C_GRACE_MS),
    ).toBe(false);
  });

  it("does not stall an unhydrated session even when it looks incomplete (switch empty window)", () => {
    // The empty window between setPaneSessionId clearing messages and the async
    // re-load: an idle session with [] messages must NOT be flagged stalled.
    expect(
      shouldTriggerIncompleteEndStall("idle", false, [], CHANNEL_C_GRACE_MS, false),
    ).toBe(false);
    // Even a non-empty array is suppressed while explicitly marked unhydrated.
    const incomplete: Message[] = [msg({ id: "u1", role: "user", content: "问题" })];
    expect(
      shouldTriggerIncompleteEndStall("idle", false, incomplete, CHANNEL_C_GRACE_MS, false),
    ).toBe(false);
  });

  it("still stalls a hydrated idle session with no completed reply", () => {
    const incomplete: Message[] = [
      msg({ id: "u1", role: "user", content: "问题" }),
      msg({ id: "t1", role: "tool", toolName: "knowledge_search", content: "[]" }),
    ];
    expect(
      shouldTriggerIncompleteEndStall("idle", false, incomplete, CHANNEL_C_GRACE_MS, true),
    ).toBe(true);
  });
});

describe("sessionMessagesHydrated", () => {
  it("is false while messages are loading", () => {
    expect(sessionMessagesHydrated({ loadingMessages: true, messageCount: 3 })).toBe(false);
  });

  it("is false during the empty switch window (no messages yet)", () => {
    expect(sessionMessagesHydrated({ loadingMessages: false, messageCount: 0 })).toBe(false);
  });

  it("is true once persisted turns are in memory", () => {
    expect(sessionMessagesHydrated({ loadingMessages: false, messageCount: 2 })).toBe(true);
    expect(sessionMessagesHydrated({ messageCount: 1 })).toBe(true);
  });
});

describe("shouldAllowStallAutoNudge", () => {
  it("blocks auto nudge when budget exceeded", () => {
    expect(shouldAllowStallAutoNudge("stall", "running", true)).toBe(false);
  });

  it("allows auto nudge for running stall with live work", () => {
    expect(shouldAllowStallAutoNudge("stall", "running", false)).toBe(true);
    expect(
      shouldAllowStallAutoNudge("stall", "running", false, { sseActive: true, runInFlight: true }),
    ).toBe(true);
  });

  it("blocks idle channel-C stall without SSE or in-flight request", () => {
    expect(
      shouldAllowStallAutoNudge("stall", "idle", false, { sseActive: false, runInFlight: false }),
    ).toBe(false);
  });

  it("allows interrupted stall for auto nudge", () => {
    expect(shouldAllowStallAutoNudge("stall", "interrupted", false)).toBe(true);
  });
});

describe("isFutileResume", () => {
  it("returns true when last turn_interrupted follows a complete reply + all todos done", () => {
    const messages: Message[] = [
      msg({ id: "u1", role: "user", content: "生成视频" }),
      msg({ id: "t1", role: "tool", content: "[x] 初始化 [x] 渲染 (2/2 completed)" }),
      msg({ id: "a1", role: "assistant", content: "视频已生成：/tmp/out.mp4" }),
      msg({
        id: "t2",
        role: "tool",
        content: "已按用户请求中断当前生成。可点「恢复执行」继续。",
        metadata: { kind: "turn_interrupted", cause: "user_interrupt" },
      }),
    ];
    expect(isFutileResume(messages)).toBe(true);
  });

  it("returns false when todos are not all done", () => {
    const messages: Message[] = [
      msg({ id: "u1", role: "user", content: "生成视频" }),
      msg({ id: "t1", role: "tool", content: "[x] 初始化 [>] 渲染 (1/2 completed)" }),
      msg({ id: "a1", role: "assistant", content: "正在渲染中……" }),
      msg({
        id: "t2",
        role: "tool",
        content: "中断",
        metadata: { kind: "turn_interrupted" },
      }),
    ];
    expect(isFutileResume(messages)).toBe(false);
  });

  it("returns false when no turn_interrupted message exists", () => {
    const messages: Message[] = [
      msg({ id: "u1", role: "user", content: "hello" }),
      msg({ id: "a1", role: "assistant", content: "hi" }),
    ];
    expect(isFutileResume(messages)).toBe(false);
  });

  it("returns false when a tool row in the last turn is still running", () => {
    const messages: Message[] = [
      msg({ id: "u1", role: "user", content: "生成视频" }),
      msg({ id: "t1", role: "tool", content: "[x] 初始化 [x] 渲染 (2/2 completed)", toolStatus: "done" }),
      msg({ id: "t2", role: "tool", content: "rendering...", toolStatus: "running" }),
      msg({ id: "a1", role: "assistant", content: "视频已生成：/tmp/out.mp4" }),
      msg({
        id: "t3",
        role: "tool",
        content: "中断",
        metadata: { kind: "turn_interrupted" },
      }),
    ];
    expect(isFutileResume(messages)).toBe(false);
  });

  it("returns false when no todo snapshot is present (conservative allow)", () => {
    const messages: Message[] = [
      msg({ id: "u1", role: "user", content: "hello" }),
      msg({ id: "a1", role: "assistant", content: "hi, done" }),
      msg({
        id: "t1",
        role: "tool",
        content: "中断",
        metadata: { kind: "turn_interrupted" },
      }),
    ];
    expect(isFutileResume(messages)).toBe(false);
  });
});
