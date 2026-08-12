import { describe, expect, it } from "vitest";
import { sanitizeInboundMessages } from "./chat-message-sanitize";

const SESSION = "01HYAAAAAAAAAAAAAAAAAAAAA1";
const TENANT = "01HYAAAAAAAAAAAAAAAAAAAAA2";
const USER = "01HYAAAAAAAAAAAAAAAAAAAAA3";

describe("sanitizeInboundMessages", () => {
  it("preserves image attachments on user messages", () => {
    const dataUrl = "data:image/png;base64,abcd";
    const messages = sanitizeInboundMessages(SESSION, TENANT, USER, [
      {
        id: "01HYAAAAAAAAAAAAAAAAAAAAA4",
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
        id: "01HYAAAAAAAAAAAAAAAAAAAAA5",
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
        id: "01HYAAAAAAAAAAAAAAAAAAAAA6",
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

  it("allows metadata-only document attachments (history outbox strip)", () => {
    const messages = sanitizeInboundMessages(SESSION, TENANT, USER, [
      {
        id: "01HYAAAAAAAAAAAAAAAAAAAAA7",
        role: "user",
        content: "hi",
        attachments: [
          {
            name: "a.pdf",
            mime_type: "application/pdf",
            size: 15_200_000,
            kind: "document",
          },
        ],
      },
    ]);
    expect(messages[0]?.attachments).toEqual([
      {
        name: "a.pdf",
        mime_type: "application/pdf",
        size: 15_200_000,
        kind: "document",
      },
    ]);
  });

  it("allows metadata-only image attachments without data_url", () => {
    const messages = sanitizeInboundMessages(SESSION, TENANT, USER, [
      {
        id: "01HYAAAAAAAAAAAAAAAAAAAAA9",
        role: "user",
        content: "看这张图",
        attachments: [
          {
            name: "shot.png",
            mime_type: "image/png",
            size: 2048,
            kind: "image",
          },
        ],
      },
    ]);
    expect(messages[0]?.attachments?.[0]).toEqual({
      name: "shot.png",
      mime_type: "image/png",
      size: 2048,
      kind: "image",
    });
  });

  it("preserves web_search_sources on assistant messages (refresh survival)", () => {
    const messages = sanitizeInboundMessages(SESSION, TENANT, USER, [
      {
        id: "01HYAAAAAAAAAAAAAAAAAAAAA8",
        role: "assistant",
        content: "答案 [1]",
        created_at: "2026-07-27T12:00:00.000Z",
        web_search_sources: [
          {
            title: "Opus 5",
            url: "https://example.com",
            snippet: "snippet",
          },
        ],
      },
    ]);
    expect(messages[0]?.web_search_sources).toHaveLength(1);
  });

  it("preserves usedByModel on web_search_sources", () => {
    const messages = sanitizeInboundMessages(SESSION, TENANT, USER, [
      {
        id: "01HYAAAAAAAAAAAAAAAAAAAAA9",
        role: "assistant",
        content: "答案 [1]",
        created_at: "2026-08-02T12:00:00.000Z",
        web_search_sources: [
          {
            title: "Used",
            url: "https://example.com/used",
            snippet: "snippet",
            usedByModel: true,
          },
          {
            title: "Unused",
            url: "https://example.com/unused",
            snippet: "snippet",
            usedByModel: false,
          },
        ],
      },
    ]);
    expect(messages[0]?.web_search_sources?.[0]?.usedByModel).toBe(true);
    expect(messages[0]?.web_search_sources?.[1]?.usedByModel).toBe(false);
  });

  it("preserves and bounds valid web_search_trace metadata", () => {
    const messages = sanitizeInboundMessages(SESSION, TENANT, USER, [
      {
        id: "01HYAAAAAAAAAAAAAAAAAAAAC1",
        role: "assistant",
        content: "答案",
        web_search_trace: {
          version: 1,
          decision: "search",
          reason: "r".repeat(800),
          resolvedQuery: "王虹与邓煜 国内风评",
          facets: Array.from({ length: 5 }, (_, index) => ({
            query: `person ${index}`,
            providerIds: ["customer-primary", "customer-secondary", "ignored-third"],
            hitCount: 10,
            uniqueHosts: 6,
          })),
          providerCalls: 2,
        },
      },
    ]);
    expect(messages[0]?.web_search_trace?.reason).toHaveLength(500);
    expect(messages[0]?.web_search_trace?.facets).toHaveLength(3);
    expect(messages[0]?.web_search_trace?.facets?.[0]?.providerIds).toEqual([
      "customer-primary",
      "customer-secondary",
    ]);
    expect(messages[0]?.web_search_trace?.resolvedQuery).toBe("王虹与邓煜 国内风评");
  });

  it("drops malformed or unknown web_search_trace without rejecting the message", () => {
    const unknown = sanitizeInboundMessages(SESSION, TENANT, USER, [
      {
        id: "01HYAAAAAAAAAAAAAAAAAAAAC2",
        role: "assistant",
        content: "still valid",
        web_search_trace: { version: 2, decision: "search", reason: "future", providerCalls: 1 },
      },
    ]);
    const malformed = sanitizeInboundMessages(SESSION, TENANT, USER, [
      {
        id: "01HYAAAAAAAAAAAAAAAAAAAAC3",
        role: "assistant",
        content: "also valid",
        web_search_trace: { version: 1, decision: "search", reason: "missing calls" },
      },
    ]);
    expect(unknown[0]?.web_search_trace).toBeUndefined();
    expect(malformed[0]?.web_search_trace).toBeUndefined();
  });

  it("keeps valid attachment_id and drops invalid ones without throwing", () => {
    const messages = sanitizeInboundMessages(SESSION, TENANT, USER, [
      {
        id: "01HYAAAAAAAAAAAAAAAAAAAAB1",
        role: "user",
        content: "总结",
        attachments: [
          {
            name: "a.pdf",
            mime_type: "application/pdf",
            kind: "document",
            attachment_id: "01HYAAAAAAAAAAAAAAAAAAAAB2",
          },
          {
            name: "b.pdf",
            mime_type: "application/pdf",
            kind: "document",
            attachment_id: "not-a-ulid",
          },
        ],
      },
    ]);
    expect(messages[0]?.attachments?.[0]?.attachment_id).toBe("01HYAAAAAAAAAAAAAAAAAAAAB2");
    expect(messages[0]?.attachments?.[1]?.attachment_id).toBeUndefined();
  });

  it("rejects empty or illegal message ids", () => {
    expect(() =>
      sanitizeInboundMessages(SESSION, TENANT, USER, [
        {
          id: "",
          role: "user",
          content: "hi",
          created_at: "2026-07-30T00:00:00.000Z",
        },
      ]),
    ).toThrow(/valid ULID/);
    expect(() =>
      sanitizeInboundMessages(SESSION, TENANT, USER, [
        {
          id: "not-a-ulid",
          role: "user",
          content: "hi",
          created_at: "2026-07-30T00:00:00.000Z",
        },
      ]),
    ).toThrow(/valid ULID/);
  });
});
