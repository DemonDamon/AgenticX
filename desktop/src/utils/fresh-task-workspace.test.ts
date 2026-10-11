import { describe, expect, it } from "vitest";
import { isFreshTask, workspaceToolLocked } from "./fresh-task-workspace";

describe("fresh task workspace", () => {
  it("treats an empty pane as a fresh task", () => {
    expect(isFreshTask([])).toBe(true);
    expect(isFreshTask([{ role: "system" }])).toBe(true);
  });

  it("unlocks tools after the first user or assistant message", () => {
    expect(isFreshTask([{ role: "user" }])).toBe(false);
    expect(isFreshTask([{ role: "assistant" }])).toBe(false);
  });

  it("keeps only the browser open on a fresh task", () => {
    expect(workspaceToolLocked("browser", true)).toBe(false);
    expect(workspaceToolLocked("terminal", true)).toBe(true);
    expect(workspaceToolLocked("workspace", true)).toBe(true);
    expect(workspaceToolLocked("terminal", false)).toBe(false);
  });
});
