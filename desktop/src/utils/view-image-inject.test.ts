import { describe, expect, it } from "vitest";
import { mapLoadedSessionMessage } from "./session-message-map";
import {
  isViewImageInjectMessage,
  VIEW_IMAGE_INJECT_METADATA_SOURCE,
} from "./view-image-inject";

describe("view_image inject display mapping", () => {
  it("maps metadata + visual_attachments to inject card payload", () => {
    const mapped = mapLoadedSessionMessage(
      {
        role: "user",
        content: "",
        metadata: { source: VIEW_IMAGE_INJECT_METADATA_SOURCE },
        visual_attachments: [
          {
            name: "image.png",
            mime_type: "image/png",
            size: 12,
            data_url: "data:image/png;base64,abc",
          },
        ],
      },
      "sess",
      0,
      "sess",
    );
    expect(isViewImageInjectMessage(mapped)).toBe(true);
    expect(mapped.content).toBe("");
    expect(mapped.attachments?.[0]?.dataUrl).toBe("data:image/png;base64,abc");
  });

  it("detects legacy English inject prefix", () => {
    expect(
      isViewImageInjectMessage({
        role: "user",
        content: "<system-injected> attached images requested via view_image tool:",
      }),
    ).toBe(true);
  });
});
