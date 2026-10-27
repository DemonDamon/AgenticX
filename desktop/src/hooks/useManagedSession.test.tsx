// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/i18n";
import { useAppStore } from "../store";
import { useManagedSession } from "./useManagedSession";

const SID = "01HMASESSION0000000000000A";
const TOOL = "01HMATOOLUSE0000000000001A";

type Frame = { streamId: string; id: number | null; event: string; data: unknown };
type StateFrame = { streamId: string; state: string; code?: string; message?: string };

const frames = new Set<(payload: Frame) => void>();
const states = new Set<(payload: StateFrame) => void>();

const maListEvents = vi.fn();
const maPostEvents = vi.fn();
const maStreamOpen = vi.fn(async (_streamId: string, _sessionId: string, _afterSeq: number) => ({ ok: true as const }));
const maStreamClose = vi.fn(async () => ({ ok: true as const }));

function wire(seq: number, id: string, type: string, extra: Record<string, unknown> = {}) {
  return { id, seq, type, created_at: "2026-10-25T00:00:00.000Z", ...extra };
}

function page(data: unknown[], hasMore: boolean, nextAfter: number) {
  return { ok: true as const, status: 200, data: { data, has_more: hasMore, next_after_seq: nextAfter } };
}

function installDesktop() {
  Object.assign(window, {
    agenticxDesktop: {
      maListEvents,
      maPostEvents,
      maStreamOpen,
      maStreamClose,
      onMaStreamFrame: (cb: (payload: Frame) => void) => {
        frames.add(cb);
        return () => frames.delete(cb);
      },
      onMaStreamState: (cb: (payload: StateFrame) => void) => {
        states.add(cb);
        return () => states.delete(cb);
      },
    },
  });
}

beforeEach(async () => {
  await i18n.changeLanguage("zh");
  frames.clear();
  states.clear();
  maListEvents.mockReset();
  maPostEvents.mockReset();
  maStreamOpen.mockClear();
  maStreamClose.mockClear();
  maStreamOpen.mockResolvedValue({ ok: true });
  maStreamClose.mockResolvedValue({ ok: true });
  useAppStore.setState({ managedApprovals: {} });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (
    setTimeout(() => cb(0), 0) as unknown as number
  ));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  installDesktop();
});

afterEach(() => {
  vi.unstubAllGlobals();
  useAppStore.setState({ managedApprovals: {} });
});

describe("useManagedSession", () => {
  it("loads paged history then opens stream at lastSeq", async () => {
    maListEvents
      .mockResolvedValueOnce(page([
        wire(1, "01HMAUSERMSG00000000000001A", "user.message", { content: [{ type: "text", text: "hi" }] }),
      ], true, 1))
      .mockResolvedValueOnce(page([
        wire(2, "01HMAAGENTMSG0000000000002A", "agent.message", { content: [{ type: "text", text: "ok" }] }),
      ], false, 2));
    const { result } = renderHook(() => useManagedSession(SID, { assistantName: "报告助手" }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(maStreamOpen).toHaveBeenCalledWith(expect.any(String), SID, 2);
    expect(result.current.messages).toHaveLength(2);
    const streamId = String(maStreamOpen.mock.calls[0]?.[0] ?? "");
    await act(async () => {
      for (const cb of frames) {
        cb({
          streamId,
          id: 3,
          event: "agent.message",
          data: wire(3, "01HMAAGENTMSG0000000000003A", "agent.message", { content: [{ type: "text", text: "more" }] }),
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(3));
  });

  it("sendMessage shows optimistic row and rolls back on 409", async () => {
    maListEvents.mockResolvedValue(page([], false, 0));
    let resolvePost: (value: { ok: false; status: number; code: string; message: string }) => void = () => undefined;
    maPostEvents.mockReturnValue(new Promise((resolve) => {
      resolvePost = resolve;
    }));
    const { result } = renderHook(() => useManagedSession(SID, { assistantName: "报告助手" }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.sendMessage("hello");
    });
    await waitFor(() => expect(result.current.messages.some((row) => row.content === "hello")).toBe(true));
    let returned: { ok: boolean; code?: string; message?: string } = { ok: true };
    await act(async () => {
      resolvePost({ ok: false, status: 409, code: "session_requires_action", message: "x" });
      returned = await pending as { ok: boolean; code?: string; message?: string };
    });
    expect(returned.ok).toBe(false);
    expect(returned.code).toBe("session_requires_action");
    expect(returned.message).toBe("请先处理待审批的工具调用");
    expect(result.current.messages.some((row) => row.content === "hello")).toBe(false);
  });

  it("resolveApproval is optimistic and keeps removal on resolution_conflict", async () => {
    maListEvents.mockResolvedValue(page([
      wire(1, TOOL, "agent.tool_use", { name: "bash_exec", input: { command: "ls" }, evaluated_policy: "always_ask" }),
      wire(2, "01HMAIDLE00000000000000002A", "session.status_idle", {
        stop_reason: { type: "requires_action", event_ids: [TOOL] },
      }),
    ], false, 2));
    const { result, unmount } = renderHook(() => useManagedSession(SID, { assistantName: "报告助手" }));
    await waitFor(() => expect(useAppStore.getState().managedApprovals[SID]?.length).toBe(1));

    maPostEvents.mockResolvedValueOnce({ ok: false, status: 409, code: "resolution_conflict", message: "x" });
    await act(async () => {
      await result.current.resolveApproval(TOOL, true);
    });
    expect(useAppStore.getState().managedApprovals[SID]).toBeUndefined();
    expect(result.current.transcript.rows[0]?.inlineConfirm).toBeUndefined();
    unmount();

    maPostEvents.mockResolvedValueOnce({ ok: false, status: 500, code: "internal_error", message: "x" });
    const again = renderHook(() => useManagedSession(SID, { assistantName: "报告助手" }));
    await waitFor(() => expect(useAppStore.getState().managedApprovals[SID]?.length).toBe(1));
    await act(async () => {
      await again.result.current.resolveApproval(TOOL, true);
    });
    expect(useAppStore.getState().managedApprovals[SID]?.some((item) => item.toolUseId === TOOL)).toBe(true);
    again.unmount();
  });

  it("unmount closes stream and clears approvals", async () => {
    maListEvents.mockResolvedValue(page([
      wire(1, TOOL, "agent.tool_use", { name: "bash_exec", input: { command: "ls" }, evaluated_policy: "always_ask" }),
      wire(2, "01HMAIDLE00000000000000002A", "session.status_idle", {
        stop_reason: { type: "requires_action", event_ids: [TOOL] },
      }),
    ], false, 2));
    const { unmount } = renderHook(() => useManagedSession(SID, { assistantName: "报告助手" }));
    await waitFor(() => expect(useAppStore.getState().managedApprovals[SID]?.length).toBe(1));
    expect(maStreamOpen).toHaveBeenCalled();
    unmount();
    expect(maStreamClose).toHaveBeenCalled();
    expect(useAppStore.getState().managedApprovals[SID]).toBeUndefined();
  });
});
