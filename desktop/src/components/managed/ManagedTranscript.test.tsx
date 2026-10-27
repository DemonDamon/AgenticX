// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/i18n";
import { createMaTranscript } from "../../utils/ma-event-adapter";
import type { ManagedSessionView } from "../../hooks/useManagedSession";
import type { Message } from "../../store";
import { ManagedTranscript } from "./ManagedTranscript";

const SID = "01HMASESSION0000000000000A";
const TOOL = "01HMATOOLUSE0000000000001A";

function view(patch: Partial<ManagedSessionView> = {}): ManagedSessionView {
  const transcript = patch.transcript ?? createMaTranscript(SID);
  return {
    ready: true,
    error: null,
    connection: "open",
    transcript,
    messages: patch.messages ?? transcript.rows,
    sendMessage: vi.fn(async () => ({ ok: true as const })),
    interrupt: vi.fn(async () => undefined),
    resolveApproval: vi.fn(async () => ({ ok: true })),
    retry: vi.fn(),
    ...patch,
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("zh");
});

describe("ManagedTranscript", () => {
  it("renders rows via MessageRenderer", () => {
    const messages: Message[] = [
      { id: "ma-u", role: "user", content: "托管你好", ownerSessionId: SID },
      { id: "ma-a", role: "assistant", content: "收到", avatarName: "报告助手", ownerSessionId: SID },
    ];
    const transcript = { ...createMaTranscript(SID), rows: messages };
    render(
      <ManagedTranscript
        view={view({ transcript, messages })}
        sessionId={SID}
        assistantName="报告助手"
      />,
    );
    expect(screen.getByText("托管你好")).toBeTruthy();
    expect(screen.getByText("收到")).toBeTruthy();
  });

  it("shows generating dots while running without liveText", () => {
    const transcript = { ...createMaTranscript(SID), status: "running" as const, liveText: "" };
    render(
      <ManagedTranscript
        view={view({ transcript, messages: [] })}
        sessionId={SID}
        assistantName="报告助手"
      />,
    );
    expect(screen.getByText("正在处理…")).toBeTruthy();
  });

  it("inline confirm calls resolveApproval", () => {
    const resolveApproval = vi.fn(async () => ({ ok: true }));
    const row: Message = {
      id: `ma-${TOOL}`,
      role: "tool",
      content: "{\"command\":\"ls\"}",
      toolCallId: TOOL,
      toolName: "bash_exec",
      toolStatus: "pending",
      ownerSessionId: SID,
      inlineConfirm: {
        requestId: TOOL,
        question: "允许执行「bash_exec」？",
        agentId: "ma",
        sessionId: SID,
        context: { maManaged: true, toolName: "bash_exec" },
      },
    };
    const transcript = { ...createMaTranscript(SID), status: "requires_action" as const, rows: [row] };
    render(
      <ManagedTranscript
        view={view({ transcript, messages: [row], resolveApproval })}
        sessionId={SID}
        assistantName="报告助手"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "同意" }));
    expect(resolveApproval).toHaveBeenCalledWith(TOOL, true);
  });

  it("does not offer session remember", () => {
    const row: Message = {
      id: `ma-${TOOL}`,
      role: "tool",
      content: "{\"command\":\"ls\"}",
      toolName: "bash_exec",
      toolStatus: "pending",
      ownerSessionId: SID,
      inlineConfirm: {
        requestId: TOOL,
        question: "允许执行「bash_exec」？",
        agentId: "ma",
        sessionId: SID,
        context: { maManaged: true, toolName: "bash_exec" },
      },
    };
    const transcript = { ...createMaTranscript(SID), status: "requires_action" as const, rows: [row] };
    render(
      <ManagedTranscript
        view={view({ transcript, messages: [row] })}
        sessionId={SID}
        assistantName="报告助手"
      />,
    );
    expect(screen.queryByText(/本会话/)).toBeNull();
  });
});
