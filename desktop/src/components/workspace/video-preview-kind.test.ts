import { describe, expect, it } from "vitest";
import { isWorkspaceVideoPath, workspaceVideoMime } from "./video-preview-kind";

describe("isWorkspaceVideoPath", () => {
  it("accepts common in-app playable suffixes", () => {
    expect(isWorkspaceVideoPath("/tmp/clip.mp4")).toBe(true);
    expect(isWorkspaceVideoPath("演示.m4v")).toBe(true);
    expect(isWorkspaceVideoPath("C:\\\\media\\\\take.MOV")).toBe(true);
    expect(isWorkspaceVideoPath("note.webm")).toBe(true);
  });

  it("rejects containers the in-app player does not handle", () => {
    expect(isWorkspaceVideoPath("movie.mkv")).toBe(false);
    expect(isWorkspaceVideoPath("movie.avi")).toBe(false);
    expect(isWorkspaceVideoPath("clip.mp4.txt")).toBe(false);
  });
});

describe("workspaceVideoMime", () => {
  it("maps webm and mov separately from mp4", () => {
    expect(workspaceVideoMime("a.webm")).toBe("video/webm");
    expect(workspaceVideoMime("a.mov")).toBe("video/quicktime");
    expect(workspaceVideoMime("a.mp4")).toBe("video/mp4");
  });
});
