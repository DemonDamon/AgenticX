import { describe, expect, it } from "vitest";
import { sanitizeInboundMessages } from "./chat-message-sanitize";

const SESSION = "01JTESTSESSION000000000000000";
const TENANT = "01JTESTTENANT0000000000000000";
const USER = "01JTESTUSER00000000000000000";

describe("sanitizeInboundMessages", () => {
  it("preserves image attachments on user messages", () => {
    const dataUrl = "data:image/png;base64,abcd";
    const messages = sanitizeInboundMessages(SESSION, TENANT, USER, [
      {
        id: "01JTESTMSG000000000000000001",
        role: "user",
        content: "描述这张图",
        created_at: "2026-06-17T12:00:00.000Z",
        attachments: [
          {
            name: "rocket.png",
            mime_type: "image/png",
            size: 128,
            data_url: dataUrl,
          },
        ],
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.attachments).toEqual([
      {
        name: "rocket.png",
        mime_type: "image/png",
        size: 128,
        data_url: dataUrl,
      },
    ]);
  });

  it("allows attachment-only user messages", () => {
    const messages = sanitizeInboundMessages(SESSION, TENANT, USER, [
      {
        id: "01JTESTMSG000000000000000002",
        role: "user",
        content: " ",
        attachments: [
          {
            name: "photo.jpg",
            mime_type: "image/jpeg",
            data_url: "data:image/jpeg;base64,xyz",
          },
        ],
      },
    ]);

    expect(messages[0]?.attachments).toHaveLength(1);
  });

  it("rejects non-image attachments", () => {
    expect(() =>
      sanitizeInboundMessages(SESSION, TENANT, USER, [
        {
          id: "01JTESTMSG000000000000000003",
          role: "user",
          content: "hi",
          attachments: [{ name: "a.pdf", mime_type: "application/pdf", data_url: "data:application/pdf;base64,x" }],
        },
      ]),
    ).toThrow(/image/i);
  });
});
