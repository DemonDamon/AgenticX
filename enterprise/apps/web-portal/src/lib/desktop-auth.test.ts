import { describe, expect, it } from "vitest";
import { DESKTOP_MANAGED_PAT_SCOPES } from "./desktop-auth";

describe("DESKTOP_MANAGED_PAT_SCOPES", () => {
  it("includes workspace:chat and desktop:managed for device tokens", () => {
    expect([...DESKTOP_MANAGED_PAT_SCOPES]).toEqual(["workspace:chat", "desktop:managed"]);
  });
});
