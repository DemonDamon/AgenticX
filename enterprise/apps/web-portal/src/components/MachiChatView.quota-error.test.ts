import { describe, expect, it } from "vitest";

import { isLegacyEnterpriseQuotaError } from "./MachiChatView";

describe("isLegacyEnterpriseQuotaError", () => {
  it.each([
    "Token 配额已用尽，请联系管理员调整额度",
    "当前账号的 Token 配额已用尽",
    "Token quota exhausted",
  ])("keeps the known legacy managed-quota message: %s", (message) => {
    expect(isLegacyEnterpriseQuotaError(message)).toBe(true);
  });

  it.each([
    "current quota exceeded",
    "upstream provider token quota exhausted",
    "rate limit exceeded",
    null,
  ])("does not promote an unrelated upstream error: %s", (message) => {
    expect(isLegacyEnterpriseQuotaError(message)).toBe(false);
  });
});
