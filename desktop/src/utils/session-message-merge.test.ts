import { describe, it, expect } from "vitest";
import type { Message } from "../store";
import { mergeSessionMessagesTail } from "./session-message-merge";
import type { LoadedSessionMessage } from "./session-message-map";

const sid = "sess-1";

function uidMsg(role: Message["role"], content: string, id: string): Message {
  return { id, role, content, agentId: "meta" } as Message;
}

function diskRow(role: Message["role"], content: string): LoadedSessionMessage {
  return { role, content } as LoadedSessionMessage;
}

describe("mergeSessionMessagesTail", () => {
  it("returns disk rows when nothing exists in memory", () => {
    const out = mergeSessionMessagesTail([], [diskRow("user", "q"), diskRow("assistant", "a")], sid);
    expect(out.map((m) => m.content)).toEqual(["q", "a"]);
  });

  it("does NOT duplicate a live uid row that disk re-sends under a positional id (拼接 guard)", () => {
    // In-memory rows committed during streaming use uid() ids; disk uses
    // positional ${sid}-i{n}. A naive id-keyed append would re-add both.
    const existing = [uidMsg("user", "q", "uid-u"), uidMsg("assistant", "answer", "uid-a")];
    const out = mergeSessionMessagesTail(
      existing,
      [diskRow("user", "q"), diskRow("assistant", "answer")],
      sid,
    );
    expect(out).toHaveLength(2);
    expect(out.map((m) => m.content)).toEqual(["q", "answer"]);
  });

  it("matches a user row by persisted client turn id before comparing representations", () => {
    const existing: Message[] = [
      {
        id: "uid-turn",
        role: "user",
        content: "乐观展示文本",
        ownerSessionId: sid,
        metadata: { client_turn_id: "turn-123" },
      },
    ];
    const diskRows: LoadedSessionMessage[] = [
      {
        role: "user",
        content: "后端规范文本",
        metadata: { client_turn_id: "turn-123" },
      },
    ];

    const out = mergeSessionMessagesTail(existing, diskRows, sid);

    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("uid-turn");
    expect(out[0].content).toBe("后端规范文本");
  });

  it("prefers client turn identity over a stale positional id match", () => {
    const existing: Message[] = [
      {
        id: `${sid}-i0`,
        role: "user",
        content: "旧位置消息",
        ownerSessionId: sid,
        metadata: { client_turn_id: "turn-old" },
      },
      {
        id: "uid-correct",
        role: "user",
        content: "当前轮消息",
        ownerSessionId: sid,
        metadata: { client_turn_id: "turn-new" },
      },
    ];
    const diskRows: LoadedSessionMessage[] = [
      {
        role: "user",
        content: "当前轮规范消息",
        metadata: { client_turn_id: "turn-new" },
      },
    ];

    const out = mergeSessionMessagesTail(existing, diskRows, sid);

    expect(out[0].id).toBe("uid-correct");
    expect(out[0].content).toBe("当前轮规范消息");
  });

  it("reconciles a short-label optimistic user row with its canonical-path disk row", () => {
    const firstPath = "/Users/demo/recruiting/aibuilder-JD.md";
    const secondPath = "/Users/demo/recruiting/2026各部门JD提报-已填写.md";
    const optimisticText =
      "按照 @aibuilder-JD.md @2026各部门JD提报-已填写.md 要求，使用 @skill://resume-screening-pipeline";
    const persistedText =
      `按照 @${firstPath} @${secondPath} 要求，使用 @skill://resume-screening-pipeline`;
    const statusText = "状态查询处于冷却窗口，我先停止本轮轮询。";
    const existing: Message[] = [
      {
        id: "uid-u",
        role: "user",
        content: optimisticText,
        agentId: "meta",
        ownerSessionId: sid,
        attachments: [
          {
            name: "aibuilder-JD.md",
            mimeType: "text/markdown",
            size: 6224,
            sourcePath: firstPath,
            referenceToken: true,
            composerRefLabel: "aibuilder-JD.md",
          },
          {
            name: "2026各部门JD提报-已填写.md",
            mimeType: "text/markdown",
            size: 61739,
            sourcePath: secondPath,
            referenceToken: true,
            composerRefLabel: "2026各部门JD提报-已填写.md",
          },
        ],
      },
      {
        id: "uid-status",
        role: "assistant",
        content: statusText,
        agentId: "meta",
        ownerSessionId: sid,
      },
    ];
    const diskRows: LoadedSessionMessage[] = [
      {
        role: "user",
        content: persistedText,
        attachments: [
          {
            name: "aibuilder-JD.md",
            mime_type: "text/plain",
            size: 6190,
            source_path: firstPath,
            reference_token: true,
            composer_ref_label: "aibuilder-JD.md",
            kind: "context_file",
          },
          {
            name: "2026各部门JD提报-已填写.md",
            mime_type: "application/octet-stream",
            size: 60321,
            source_path: secondPath,
            reference_token: true,
            composer_ref_label: "2026各部门JD提报-已填写.md",
            kind: "context_file",
          },
        ],
      },
      diskRow("assistant", statusText),
    ];

    const out = mergeSessionMessagesTail(existing, diskRows, sid);
    const userRows = out.filter((message) => message.role === "user");

    expect(out.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(userRows).toHaveLength(1);
    expect(userRows[0].id).toBe("uid-u");
    expect(userRows[0].attachments).toHaveLength(2);
  });

  it("does not overlay a latest in-memory attachment onto an older same-text disk turn", () => {
    const firstPath = "/Users/demo/project-a/context.md";
    const secondPath = "/Users/demo/project-b/context.md";
    const content = "请检查附件";
    const existing: Message[] = [
      {
        id: "uid-latest",
        role: "user",
        content,
        ownerSessionId: sid,
        attachments: [
          {
            name: "context.md",
            mimeType: "text/markdown",
            size: 20,
            sourcePath: secondPath,
            referenceToken: true,
            composerRefLabel: "context.md",
          },
        ],
      },
    ];
    const diskAttachment = (sourcePath: string) => [
      {
        name: "context.md",
        mime_type: "text/markdown",
        size: 20,
        source_path: sourcePath,
        reference_token: true,
        composer_ref_label: "context.md",
        kind: "context_file",
      },
    ];
    const diskRows: LoadedSessionMessage[] = [
      { role: "user", content, attachments: diskAttachment(firstPath) },
      diskRow("assistant", "第一轮完成"),
      { role: "user", content, attachments: diskAttachment(secondPath) },
    ];

    const out = mergeSessionMessagesTail(existing, diskRows, sid);
    const userRows = out.filter((message) => message.role === "user");

    expect(userRows).toHaveLength(2);
    expect(userRows.map((message) => message.attachments?.[0]?.sourcePath)).toEqual([
      firstPath,
      secondPath,
    ]);
    expect(userRows[1].id).toBe("uid-latest");
  });

  it("appends a missing tail reply that only exists on disk (缺失自愈)", () => {
    const existing = [uidMsg("user", "q", "uid-u")];
    const out = mergeSessionMessagesTail(
      existing,
      [diskRow("user", "q"), diskRow("assistant", "answer")],
      sid,
    );
    expect(out).toHaveLength(2);
    expect(out[1].role).toBe("assistant");
    expect(out[1].content).toBe("answer");
  });

  it("preserves genuinely repeated same-content turns from disk", () => {
    const existing = [uidMsg("user", "q", "uid-u")];
    const out = mergeSessionMessagesTail(existing, [diskRow("user", "q"), diskRow("user", "q")], sid);
    // One in-memory + one extra disk occurrence = two user rows total.
    expect(out.filter((m) => m.role === "user")).toHaveLength(2);
  });

  it("merges enrichments onto id-matched disk rows", () => {
    const existing: Message[] = [
      { id: `${sid}-i0`, role: "user", content: "q", agentId: "meta" } as Message,
      {
        id: `${sid}-i1`,
        role: "assistant",
        content: "answer",
        agentId: "meta",
        suggestedQuestions: ["next?"],
      } as Message,
    ];
    const out = mergeSessionMessagesTail(
      existing,
      [diskRow("user", "q"), diskRow("assistant", "answer")],
      sid,
    );
    expect(out).toHaveLength(2);
    expect(out[1].suggestedQuestions).toEqual(["next?"]);
  });

  it("reconciles a live reasoning row against its sanitized disk body (no duplicate, refs preserved)", () => {
    const refs = [
      { id: 1, title: "Doc", url: "https://x", snippet: "s", source: "web" as const },
    ];
    const existing: Message[] = [
      uidMsg("user", "q", "uid-u"),
      {
        id: "uid-a",
        role: "assistant",
        content: "<think>盘算 17 秒</think>这是最终答案<followups>追问?</followups>",
        agentId: "meta",
        references: refs,
      } as Message,
    ];
    const out = mergeSessionMessagesTail(
      existing,
      [diskRow("user", "q"), diskRow("assistant", "这是最终答案")],
      sid,
    );
    expect(out).toHaveLength(2);
    expect(out[1].role).toBe("assistant");
    expect(out[1].references?.length).toBe(1);
  });

  it("preserves persisted reasoning fields when overlaying memory onto disk", () => {
    const existing: Message[] = [
      uidMsg("user", "q", "uid-u"),
      {
        id: "uid-a",
        role: "assistant",
        content: "这是最终答案",
        agentId: "meta",
        reasoning: "盘算 17 秒",
        reasoningSeconds: 17,
      } as Message,
    ];
    const out = mergeSessionMessagesTail(
      existing,
      [diskRow("user", "q"), diskRow("assistant", "这是最终答案")],
      sid,
    );
    expect(out).toHaveLength(2);
    expect(out[1].reasoning).toBe("盘算 17 秒");
    expect(out[1].reasoningSeconds).toBe(17);
  });

  it("drops accumulated duplicate reasoning copies left by earlier failed merges", () => {
    const body = "<think>盘算 17 秒</think>这是最终答案";
    const existing: Message[] = [
      uidMsg("user", "q", "uid-u"),
      { id: "uid-a1", role: "assistant", content: body, agentId: "meta" } as Message,
      { id: "uid-a2", role: "assistant", content: body, agentId: "meta" } as Message,
      { id: "uid-a3", role: "assistant", content: body, agentId: "meta" } as Message,
    ];
    const out = mergeSessionMessagesTail(
      existing,
      [diskRow("user", "q"), diskRow("assistant", "这是最终答案")],
      sid,
    );
    expect(out.filter((m) => m.role === "assistant")).toHaveLength(1);
  });

  it("keeps disk chronological order when memory only holds the latest tail (no append-old-to-end bug)", () => {
    const existing = [
      uidMsg("user", "latest q", "uid-u2"),
      uidMsg("assistant", "latest a", "uid-a2"),
    ];
    const out = mergeSessionMessagesTail(
      existing,
      [
        diskRow("user", "old q"),
        diskRow("assistant", "old a"),
        diskRow("user", "latest q"),
        diskRow("assistant", "latest a"),
      ],
      sid,
    );
    expect(out.map((m) => m.content)).toEqual(["old q", "old a", "latest q", "latest a"]);
  });
});
