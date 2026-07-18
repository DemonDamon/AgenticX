import { describe, expect, it } from "vitest";
import { StreamCommitRegistry } from "./stream-commit-registry";

describe("StreamCommitRegistry", () => {
  it("beginSession initializes empty state", () => {
    const reg = new StreamCommitRegistry();
    reg.beginSession("sid-a");
    expect(reg.getText("sid-a")).toBe("");
    expect(reg.isCommitted("sid-a")).toBe(false);
    expect(reg.getMidCommit("sid-a")).toBeNull();
  });

  it("interleaved sessions do not clobber text", () => {
    const reg = new StreamCommitRegistry();
    reg.beginSession("A");
    reg.beginSession("B");
    reg.setText("A", "a1");
    reg.setText("B", "b1");
    reg.setText("A", "a2");
    expect(reg.getText("A")).toBe("a2");
    expect(reg.getText("B")).toBe("b1");
  });

  it("committed flag is isolated per session", () => {
    const reg = new StreamCommitRegistry();
    reg.beginSession("A");
    reg.beginSession("B");
    reg.markCommitted("B");
    expect(reg.isCommitted("B")).toBe(true);
    expect(reg.isCommitted("A")).toBe(false);
  });

  it("atomically claims uncommitted text once", () => {
    const reg = new StreamCommitRegistry();
    reg.beginSession("A");
    reg.setText("A", "partial answer");

    expect(reg.claimUncommittedText("A")).toBe("partial answer");
    expect(reg.isCommitted("A")).toBe(true);
    expect(reg.claimUncommittedText("A")).toBeNull();
  });

  it("does not claim missing or empty session text", () => {
    const reg = new StreamCommitRegistry();
    reg.beginSession("A");

    expect(reg.claimUncommittedText("missing")).toBeNull();
    expect(reg.claimUncommittedText("A")).toBeNull();
    expect(reg.isCommitted("A")).toBe(false);
  });

  it("claims text independently across sessions", () => {
    const reg = new StreamCommitRegistry();
    reg.beginSession("A");
    reg.beginSession("B");
    reg.setText("A", "answer A");
    reg.setText("B", "answer B");

    expect(reg.claimUncommittedText("A")).toBe("answer A");
    expect(reg.isCommitted("B")).toBe(false);
    expect(reg.claimUncommittedText("B")).toBe("answer B");
  });

  it("midCommit is isolated per session", () => {
    const reg = new StreamCommitRegistry();
    reg.beginSession("A");
    reg.beginSession("B");
    reg.setMidCommit("A", "x");
    reg.setMidCommit("B", "y");
    expect(reg.getMidCommit("A")).toBe("x");
    expect(reg.getMidCommit("B")).toBe("y");
  });

  it("resetTurnSegment clears only target session text+committed", () => {
    const reg = new StreamCommitRegistry();
    reg.beginSession("A");
    reg.beginSession("B");
    reg.setText("A", "a1");
    reg.setText("B", "b1");
    reg.markCommitted("A");
    reg.setMidCommit("A", "mid-a");
    reg.resetTurnSegment("A");
    expect(reg.getText("A")).toBe("");
    expect(reg.isCommitted("A")).toBe(false);
    expect(reg.getMidCommit("A")).toBe("mid-a");
    expect(reg.getText("B")).toBe("b1");
    expect(reg.isCommitted("B")).toBe(false);
  });

  it("clearSession removes all entries for one session only", () => {
    const reg = new StreamCommitRegistry();
    reg.beginSession("A");
    reg.beginSession("B");
    reg.setText("A", "a1");
    reg.setText("B", "b1");
    reg.markCommitted("A");
    reg.setMidCommit("A", "mid-a");
    reg.clearSession("A");
    expect(reg.getText("A")).toBe("");
    expect(reg.isCommitted("A")).toBe(false);
    expect(reg.getMidCommit("A")).toBeNull();
    expect(reg.getText("B")).toBe("b1");
    expect(reg.isCommitted("B")).toBe(false);
  });
});
