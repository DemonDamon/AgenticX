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
