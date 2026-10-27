import { describe, expect, it } from "vitest";

import { MaChannelValidationError, normalizeChannelInput } from "../ma-channels";

const AGENT = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const VAULT = "01BX5ZZKBKACTAV9WEVGEMMVSX";
const CREDENTIAL = "01C23456789ABCDEFGHJKMNPQR";

function createBody(extra: Record<string, unknown> = {}) {
  return {
    name: "项目助理",
    agent_id: AGENT,
    app_id: "cli_a1b2c3",
    credential: { vault_id: VAULT, credential_id: CREDENTIAL },
    ...extra,
  };
}

describe("channel input", () => {
  it("rejects an app id that is not a Feishu client id", () => {
    expect(() => normalizeChannelInput(createBody({ app_id: "abc" }), "create")).toThrow("app_id: is invalid");
  });

  it("rejects pinned routing without a version", () => {
    expect(() => normalizeChannelInput(createBody({ routing: "pinned" }), "create")).toThrow(MaChannelValidationError);
  });

  it("rejects an open base outside the two allowed sites", () => {
    expect(() =>
      normalizeChannelInput(createBody({ config: { open_base_url: "https://evil.example.com" } }), "create"),
    ).toThrow(MaChannelValidationError);
  });

  it("rejects unknown config keys", () => {
    expect(() => normalizeChannelInput(createBody({ config: { extra: 1 } }), "create")).toThrow(
      "config.extra: is not allowed",
    );
  });

  it("rejects an owner submitted by the caller", () => {
    expect(() => normalizeChannelInput(createBody({ owner_user_id: AGENT }), "create")).toThrow(
      "owner_user_id: is not allowed",
    );
  });

  it("rejects changing app_id on update", () => {
    expect(() => normalizeChannelInput({ app_id: "cli_newapp1" }, "update")).toThrow("app_id: is immutable");
  });

  it("defaults follow_latest and the Feishu site", () => {
    const input = normalizeChannelInput(createBody(), "create");
    expect(input.routing).toBe("follow_latest");
    expect(input.pinnedVersion).toBeNull();
    expect(input.config).toEqual({ idle_reset_hours: 24, open_base_url: "https://open.feishu.cn" });
  });
});
