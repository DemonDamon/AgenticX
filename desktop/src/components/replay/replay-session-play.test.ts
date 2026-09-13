import { describe, expect, it } from "vitest";
import {
  bindMessagesToRun,
  sliceMessagesForPresentation,
} from "./replay-presentation";
import {
  canOfferSessionPlay,
  mergeSessionReplay,
  presentableSessionRuns,
  retainReplaySelection,
  SESSION_PLAY_ID,
} from "./replay-session-play";
import type { ReplayEvent, ReplayRun } from "./replay-types";

function run(
  runId: string,
  createdAt: number,
  status: ReplayRun["status"] = "completed",
): ReplayRun {
  return {
    runId,
    sessionId: "session-1",
    turnId: runId,
    agentId: "meta",
    status,
    createdAt,
    completedAt: createdAt + 1_000,
    eventCount: 3,
    completeness: "complete",
  };
}

function event(runId: string, seq: number, type: string, extra: Partial<ReplayEvent> = {}): ReplayEvent {
  return {
    eventId: `${runId}-${seq}`,
    runId,
    seq,
    ts: seq * 1_000,
    type,
    agentId: "meta",
    title: type,
    summary: "",
    effectClass: "none",
    branchable: false,
    ...extra,
  };
}

describe("presentableSessionRuns", () => {
  it("keeps only finished runs, oldest first, and needs two to offer session play", () => {
    const runs = [
      run("late", 3_000),
      run("live", 4_000, "running"),
      run("early", 1_000),
    ];
    expect(presentableSessionRuns(runs).map((item) => item.runId)).toEqual(["early", "late"]);
    expect(canOfferSessionPlay(runs)).toBe(true);
    expect(canOfferSessionPlay([run("only", 1_000)])).toBe(false);
    expect(canOfferSessionPlay([run("only", 1_000), run("live", 2_000, "running")])).toBe(false);
  });

  it("does not let a run-list refresh knock session play back to the latest run", () => {
    const runs = [run("late", 3_000), run("early", 1_000)];
    expect(retainReplaySelection(SESSION_PLAY_ID, runs)).toBe(SESSION_PLAY_ID);
    expect(retainReplaySelection(SESSION_PLAY_ID, runs, "late")).toBe(SESSION_PLAY_ID);
    expect(retainReplaySelection("early", runs)).toBe("early");
    expect(retainReplaySelection("", runs)).toBe("late");
    expect(retainReplaySelection("", runs, "early")).toBe("early");
    expect(retainReplaySelection(SESSION_PLAY_ID, [run("only", 1_000)])).toBe("only");
  });
});

describe("mergeSessionReplay", () => {
  it("shifts the later run so seq stays monotonic", () => {
    const merged = mergeSessionReplay([
      {
        run: run("run-b", 2_000),
        events: [
          event("run-b", 1, "user_message"),
          event("run-b", 2, "assistant_output_completed"),
        ],
      },
      {
        run: run("run-a", 1_000),
        events: [
          event("run-a", 1, "user_message"),
          event("run-a", 2, "tool_call"),
          event("run-a", 3, "assistant_output_completed"),
        ],
      },
    ]);
    expect(merged.run.runId).toBe(SESSION_PLAY_ID);
    expect(merged.events.map((item) => item.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(merged.events.map((item) => item.eventId)).toEqual([
      "run-a-1",
      "run-a-2",
      "run-a-3",
      "run-b-1",
      "run-b-2",
    ]);
    expect(merged.events[3]?.seq).toBe(4);
  });

  it("reveals the second-turn user line only after the merged user_message beat", () => {
    const merged = mergeSessionReplay([
      {
        run: run("run-a", 1_000),
        events: [
          event("run-a", 1, "user_message", { payload: { text: "第一问" } }),
          event("run-a", 2, "assistant_output_completed"),
        ],
      },
      {
        run: run("run-b", 2_000),
        events: [
          event("run-b", 1, "user_message", { payload: { text: "第二问" } }),
          event("run-b", 2, "assistant_output_completed"),
        ],
      },
    ]);
    const messages = [
      { id: "u1", role: "user", content: "第一问" },
      { id: "a1", role: "assistant", content: "第一答" },
      { id: "u2", role: "user", content: "第二问" },
      { id: "a2", role: "assistant", content: "第二答" },
    ];
    const binding = bindMessagesToRun(messages, merged.events);
    expect(binding.canPresent).toBe(true);
    expect(sliceMessagesForPresentation(messages, binding, 1, 4).map((item) => item.id))
      .toEqual(["u1"]);
    expect(sliceMessagesForPresentation(messages, binding, 3, 4).map((item) => item.id))
      .toEqual(["u1", "a1", "u2"]);
  });
});
