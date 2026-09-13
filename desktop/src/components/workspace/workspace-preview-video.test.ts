import { describe, expect, it } from "vitest";
import { mapTaskspaceFileToWorkspacePreview } from "./workspace-preview-types";

describe("mapTaskspaceFileToWorkspacePreview video", () => {
  it("maps a video preview_kind to an in-app player payload", () => {
    const preview = mapTaskspaceFileToWorkspacePreview(
      {
        ok: true,
        path: "clip.mp4",
        absolute_path: "/tmp/clip.mp4",
        size: 4096,
        mime_type: "video/mp4",
        preview_kind: "video",
      },
      "clip.mp4",
    );
    expect(preview).toEqual({
      kind: "video",
      path: "clip.mp4",
      absolutePath: "/tmp/clip.mp4",
      size: 4096,
      mimeType: "video/mp4",
    });
  });

  it("still opens mp4 when the backend labels it as binary", () => {
    const preview = mapTaskspaceFileToWorkspacePreview(
      {
        ok: true,
        path: "talk.mp4",
        absolute_path: "/tmp/talk.mp4",
        size: 12,
        mime_type: "application/octet-stream",
        preview_kind: "binary",
      },
      "talk.mp4",
    );
    expect(preview?.kind).toBe("video");
    expect(preview && preview.kind === "video" ? preview.mimeType : "").toBe("video/mp4");
  });
});
