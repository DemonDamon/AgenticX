import { describe, expect, it } from "vitest";
import { compactStoredAvatarUrl } from "./compact-stored-avatar-url";
import { mapLoadedSessionMessage } from "./session-message-map";

describe("compactStoredAvatarUrl", () => {
  it("drops data URLs", () => {
    expect(compactStoredAvatarUrl("data:image/png;base64,AAAA")).toBe("");
  });

  it("keeps short https URLs", () => {
    expect(compactStoredAvatarUrl("https://cdn.example/a.png")).toBe(
      "https://cdn.example/a.png"
    );
  });

  it("drops overlong non-data URLs", () => {
    expect(compactStoredAvatarUrl("x".repeat(3000))).toBe("");
  });
});

describe("mapLoadedSessionMessage avatar compact", () => {
  it("strips huge data avatar_url from loaded rows", () => {
    const mapped = mapLoadedSessionMessage(
      {
        role: "assistant",
        content: "hi",
        agent_id: "abc",
        avatar_name: "专家",
        avatar_url: `data:image/svg+xml;base64,${"x".repeat(60_000)}`,
      },
      "sid",
      0,
      "sid"
    );
    expect(mapped.avatarUrl).toBeFalsy();
  });
});
