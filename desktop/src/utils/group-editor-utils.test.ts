import assert from "node:assert/strict";
import test from "node:test";

import {
  extractUnknownAvatarIdFromError,
  getGroupSaveErrorMessage,
  sanitizeGroupAvatarIds,
} from "./group-editor-utils.ts";

test("sanitizeGroupAvatarIds: 过滤失效 avatar_id 并去重", () => {
  const out = sanitizeGroupAvatarIds({
    requestedIds: [" av1 ", "av2", "ghost", "av1", "", "  "],
    validAvatarIds: ["av1", "av2", "av3"],
  });

  assert.deepEqual(out.avatarIds, ["av1", "av2"]);
  assert.deepEqual(out.removedIds, ["ghost"]);
});

test("getGroupSaveErrorMessage: unknown avatar_id 返回友好提示", () => {
  const msg = getGroupSaveErrorMessage(
    'HTTP 400: {"detail":"unknown avatar_id: 8ba7ebdd7acc"}',
  );
  assert.equal(
    msg,
    "检测到群成员里包含已失效分身，已自动过滤。请确认成员后再次保存。",
  );
});

test("getGroupSaveErrorMessage: 普通错误保留原文", () => {
  const msg = getGroupSaveErrorMessage("HTTP 500: internal error");
  assert.equal(msg, "HTTP 500: internal error");
});

test("extractUnknownAvatarIdFromError: 能提取后端返回的失效 avatar_id", () => {
  const avatarId = extractUnknownAvatarIdFromError(
    'HTTP 400: {"detail":"unknown avatar_id: 8ba7ebdd7acc"}',
  );
  assert.equal(avatarId, "8ba7ebdd7acc");
});
