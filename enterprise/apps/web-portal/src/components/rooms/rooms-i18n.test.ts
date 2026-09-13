import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { formatRoomTime } from "./RoomListView";

const CJK = /[\u4e00-\u9fff]/;

const REQUIRED_ROOMS_KEYS = [
  "title",
  "backToWorkspace",
  "newRoom",
  "noMessages",
  "loadFailed",
  "loadFailedShort",
  "defaultTitle",
  "createFailed",
  "createFailedShort",
  "loading",
  "empty",
  "memberCount",
  "roomNamePlaceholder",
  "cancel",
  "create",
  "creating",
  "backToList",
  "statusLive",
  "statusPolling",
  "statusConnecting",
  "revoked",
  "openFailed",
  "sendFailed",
  "me",
  "member",
  "sending",
  "inputPlaceholder",
  "send",
  "membersTitle",
  "metaAssistant",
  "owner",
  "remove",
  "addEmailPlaceholder",
  "adding",
  "addMember",
  "userNotFound",
  "addFailed",
  "leaveFailed",
  "leaveFailedShort",
  "removeFailed",
  "removeFailedShort",
  "leaveRoom",
  "leaveConfirm",
  "removeMemberTitle",
  "removeConfirm",
] as const;

describe("rooms i18n", () => {
  it("has paired zh/en keys for rooms chrome", () => {
    for (const key of REQUIRED_ROOMS_KEYS) {
      expect(zh.rooms[key], `zh missing ${key}`).toEqual(expect.any(String));
      expect(en.rooms[key], `en missing ${key}`).toEqual(expect.any(String));
      expect(en.rooms[key]).not.toMatch(CJK);
      expect(zh.rooms[key]).toMatch(CJK);
    }
  });
});

describe("formatRoomTime", () => {
  it("returns the empty label when timestamp is missing or invalid", () => {
    expect(formatRoomTime(undefined, "en", "No messages yet")).toBe("No messages yet");
    expect(formatRoomTime("not-a-date", "zh", "暂无消息")).toBe("暂无消息");
  });
});
