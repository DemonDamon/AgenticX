import { describe, expect, it } from "vitest";
import {
  isCurrentWorkspaceRequest,
  workspaceNodeKey,
} from "./workspace-session-cache";

describe("workspace session cache keys", () => {
  it("keeps identical taskspace paths isolated between sessions", () => {
    expect(workspaceNodeKey("session-a", "default", ".")).not.toBe(
      workspaceNodeKey("session-b", "default", "."),
    );
  });

  it("rejects a response that belongs to a session that is no longer active", () => {
    expect(isCurrentWorkspaceRequest("session-a", "session-b")).toBe(false);
    expect(isCurrentWorkspaceRequest("session-b", "session-b")).toBe(true);
  });
});
