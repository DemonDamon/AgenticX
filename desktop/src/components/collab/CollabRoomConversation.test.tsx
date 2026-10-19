/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/i18n";
import { CollabRoomConversation } from "./CollabRoomConversation";

vi.mock("../../store", () => ({
  useAppStore: (
    selector: (state: {
      apiBase: string;
      apiToken: string;
      setActiveCollabRoomId: (id: string | null) => void;
    }) => unknown,
  ) =>
    selector({
      apiBase: "http://127.0.0.1:8000",
      apiToken: "token",
      setActiveCollabRoomId: () => undefined,
    }),
}));

const ROOM = "01R00M0AAAAAAAAAAAAAAAAAAA";
const VIEWER = "01HZX3NDEKTSV4RRFFQ69G5FAV";
const PEER = "01PEER0AAAAAAAAAAAAAAAAAAA";
const SOURCE = "01MAIN0AAAAAAAAAAAAAAAAAAA";

function message(partial: Record<string, unknown>) {
  return {
    id: "01MSG0AAAAAAAAAAAAAAAAAAAA",
    room_id: ROOM,
    seq: 1,
    sender_type: "system",
    sender_id: "system",
    sender_name: "系统",
    content: "",
    client_msg_id: null,
    metadata: null,
    ...partial,
  };
}

describe("CollabRoomConversation merge extras", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh");
    window.agenticxDesktop = {
      collabRoomGet: vi.fn(async () => ({
        ok: true,
        data: {
          room: { id: ROOM, title: "小群", member_count: 2, last_seq: 3 },
          members: [],
          viewer_user_id: VIEWER,
        },
      })),
      collabRoomMessages: vi.fn(async () => ({
        ok: true,
        data: {
          messages: [
            message({
              id: "01MSG0AAAAAAAAAAAAAAAAAAAA",
              seq: 1,
              content: "【合回摘要自「设计组」】\n结论",
              metadata: {
                kind: "merge_back",
                source_room_id: SOURCE,
                source_title: "设计组",
                mode: "summary",
                participants: ["Alice"],
                count: 3,
              },
            }),
            message({
              id: "01MSG1AAAAAAAAAAAAAAAAAAAA",
              seq: 2,
              content: "【合回申请】等待对方确认",
              metadata: {
                kind: "merge_request",
                requested_by: PEER,
                target_room_id: SOURCE,
                mode: "all",
              },
            }),
            message({
              id: "01MSG2AAAAAAAAAAAAAAAAAAAA",
              seq: 3,
              content: "【合回申请】等待对方确认",
              metadata: {
                kind: "merge_request",
                requested_by: VIEWER,
                target_room_id: SOURCE,
                mode: "all",
              },
            }),
          ],
        },
      })),
      collabRoomWatch: vi.fn(async () => ({ ok: true })),
      collabRoomUnwatch: vi.fn(async () => ({ ok: true })),
      onCollabRoomEvent: vi.fn(() => () => undefined),
      collabRoomSend: vi.fn(async () => ({ ok: true, data: { message: null } })),
      collabRoomApproveMerge: vi.fn(async () => ({ ok: true, data: { message: null } })),
    } as unknown as Window["agenticxDesktop"];
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a merge-back card and an approve button only for the other person", async () => {
    render(<CollabRoomConversation roomId={ROOM} />);
    expect(await screen.findByText("合回自「设计组」")).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看原群" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "同意合回" })).toHaveLength(1);
  });
});
