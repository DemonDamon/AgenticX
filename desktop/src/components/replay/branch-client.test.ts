import { describe, expect, it, vi } from "vitest";
import { createRunBranch } from "./branch-client";
import {
  createPaneTextSender,
  registerPaneTextSender,
  sendTextToPane,
} from "../../chat/send-text-to-pane";

describe("createRunBranch", () => {
  it("posts a validated branch request and parses requested and resolved events", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      session_id: "child-session",
      source_run_id: "run-a",
      resolved_checkpoint_seq: 100,
      requested_event: { event_id: "e101", seq: 101, type: "tool_call", title: "bash" },
      resolved_event: { event_id: "e100", seq: 100, type: "tool_result", title: "file" },
      lineage: { parent_session_id: "source", parent_run_id: "run-a" },
      warnings: [],
      instruction: "continue",
      provider: "p",
      model: "m",
    }), { status: 200 }));

    const result = await createRunBranch(
      "http://localhost:8000",
      "token",
      "run-a",
      { sourceEventId: "e101", instruction: "continue", provider: "p", model: "m" },
      fetcher,
    );

    expect(result.sessionId).toBe("child-session");
    expect(result.sourceRunId).toBe("run-a");
    expect(result.resolvedCheckpointSeq).toBe(100);
    expect(result.requestedEvent.seq).toBe(101);
    expect(result.resolvedEvent.seq).toBe(100);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("keeps the backend code and detail on failure without echoing request payload", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      detail: { code: "source_session_running", detail: "source session is running" },
    }), { status: 409 }));
    await expect(createRunBranch(
      "http://localhost:8000",
      "token",
      "run-a",
      { sourceEventId: "e101", instruction: "secret instruction" },
      fetcher,
    )).rejects.toMatchObject({
      code: "source_session_running",
      message: "source session is running",
    });
  });
});

describe("branch continuation sending", () => {
  it("queues once until the new pane registers its existing send pipeline", async () => {
    const pending = sendTextToPane("pane-new", "continue once");
    const sent: string[] = [];
    const unregister = registerPaneTextSender("pane-new", async (text) => {
      sent.push(text);
    });
    await pending;
    expect(sent).toEqual(["continue once"]);
    unregister();
  });

  it("delegates an ordinary pane send exactly once without changing pane context", async () => {
    const context = {
      queueLength: 0,
      provider: "provider-a",
      model: "model-a",
      sessionId: "session-a",
    };
    const existingPipeline = vi.fn(async (_text: string) => undefined);
    const restoreComposer = vi.fn();
    const unregister = registerPaneTextSender(
      "pane-ordinary",
      createPaneTextSender(existingPipeline, restoreComposer),
    );

    await sendTextToPane("pane-ordinary", "ordinary message");

    expect(existingPipeline).toHaveBeenCalledOnce();
    expect(existingPipeline).toHaveBeenCalledWith("ordinary message");
    expect(restoreComposer).not.toHaveBeenCalled();
    expect(context).toEqual({
      queueLength: 0,
      provider: "provider-a",
      model: "model-a",
      sessionId: "session-a",
    });
    unregister();
  });

  it("restores externally submitted text when the existing pipeline rejects", async () => {
    const restoreComposer = vi.fn();
    const sender = createPaneTextSender(
      async () => {
        throw new Error("request failed");
      },
      restoreComposer,
    );

    await expect(sender("continue safely")).rejects.toThrow("request failed");
    expect(restoreComposer).toHaveBeenCalledOnce();
    expect(restoreComposer).toHaveBeenCalledWith("continue safely");
  });
});
