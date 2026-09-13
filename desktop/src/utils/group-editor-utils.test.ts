import assert from "node:assert/strict";
import { test } from "vitest";

import { i18n } from "../i18n/i18n";
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
  assert.equal(msg, i18n.t("groups.unknownAvatarFiltered", { ns: "sidebar" }));
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
