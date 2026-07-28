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
        kind: "image",
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

  it("preserves document attachments with parsed_text", () => {
    const messages = sanitizeInboundMessages(SESSION, TENANT, USER, [
      {
        id: "01JTESTMSG000000000000000003",
        role: "user",
        content: "总结这份文档",
        attachments: [
          {
            name: "a.pdf",
            mime_type: "application/pdf",
            kind: "document",
            parsed_text: "hello document",
          },
        ],
      },
    ]);
    expect(messages[0]?.attachments?.[0]?.parsed_text).toBe("hello document");
  });

  it("rejects document attachments without parsed_text", () => {
    expect(() =>
      sanitizeInboundMessages(SESSION, TENANT, USER, [
        {
          id: "01JTESTMSG000000000000000003b",
          role: "user",
          content: "hi",
          attachments: [{ name: "a.pdf", mime_type: "application/pdf", kind: "document" }],
        },
      ]),
    ).toThrow(/parsed_text/i);
  });

  it("preserves web_search_sources on assistant messages (refresh survival)", () => {
    const messages = sanitizeInboundMessages(SESSION, TENANT, USER, [
      {
        id: "01JTESTMSG000000000000000004",
        role: "assistant",
        content: "答案 [1]",
        created_at: "2026-07-27T12:00:00.000Z",
        web_search_sources: [
          {
            title: "Opus 5",
            url: "https://zhuanlan.zhihu.com/p/123",
            snippet: "snippet",
          },
        ],
      },
    ]);

    expect(messages[0]?.web_search_sources).toEqual([
      {
        title: "Opus 5",
        url: "https://zhuanlan.zhihu.com/p/123",
        snippet: "snippet",
      },
    ]);
  });
});
