import { describe, expect, it } from "vitest";
import {
  COMPOSER_DRAFT_MAX_ENTRIES,
  COMPOSER_DRAFT_MAX_INLINE_DATA_URL_CHARS,
  COMPOSER_DRAFT_MAX_STORE_CHARS,
  COMPOSER_DRAFT_TTL_MS,
  composerDraftIdentity,
  migrateComposerDraftInRaw,
  parseComposerDraftCollection,
  readComposerDraftFromRaw,
  removeComposerDraftFromRaw,
  writeComposerDraftToRaw,
  type ComposerDraft,
} from "./composer-draft-storage";

const NOW = 2_000_000_000_000;

function draft(
  text: string,
  patch: Partial<Omit<ComposerDraft, "updatedAt">> = {},
): Omit<ComposerDraft, "updatedAt"> {
  return {
    text,
    attachments: [],
    quotes: [],
    refPaths: {},
    refMetaOverrides: {},
    ...patch,
  };
}

describe("composerDraftIdentity", () => {
  it("uses the session id once a pane is bound", () => {
    expect(
      composerDraftIdentity({ paneId: "pane-1", avatarId: "avatar-1", sessionId: "sid-1" }),
    ).toBe("session:sid-1");
  });

  it("isolates provisional drafts by pane and avatar", () => {
    expect(
      composerDraftIdentity({ paneId: "pane-1", avatarId: null, sessionId: "" }),
    ).toBe("pane:pane-1:avatar:meta");
    expect(
      composerDraftIdentity({ paneId: "pane-1", avatarId: "avatar:工程", sessionId: "" }),
    ).toBe("pane:pane-1:avatar:avatar%3A%E5%B7%A5%E7%A8%8B");
  });
});

describe("composer draft raw collection", () => {
  it("treats malformed or unknown storage as empty", () => {
    expect(parseComposerDraftCollection("{", NOW).drafts).toEqual({});
    expect(parseComposerDraftCollection('{"version":2,"drafts":{}}', NOW).drafts).toEqual({});
  });

  it("keeps session drafts isolated and removes an empty replacement", () => {
    let raw = writeComposerDraftToRaw(null, "session:A", draft("A 草稿"), NOW);
    raw = writeComposerDraftToRaw(raw, "session:B", draft("B 草稿"), NOW + 1);

    expect(readComposerDraftFromRaw(raw, "session:A", NOW + 2)?.text).toBe("A 草稿");
    expect(readComposerDraftFromRaw(raw, "session:B", NOW + 2)?.text).toBe("B 草稿");

    raw = writeComposerDraftToRaw(raw, "session:A", draft("   "), NOW + 3);
    expect(readComposerDraftFromRaw(raw, "session:A", NOW + 4)).toBeNull();
    expect(readComposerDraftFromRaw(raw, "session:B", NOW + 4)?.text).toBe("B 草稿");
  });

  it("migrates a provisional draft and deletes its source key", () => {
    const provisional = "pane:pane-1:avatar:meta";
    let raw = writeComposerDraftToRaw(null, provisional, draft("首条消息前"), NOW);
    raw = migrateComposerDraftInRaw(raw, provisional, "session:new", NOW + 1);

    expect(readComposerDraftFromRaw(raw, provisional, NOW + 2)).toBeNull();
    expect(readComposerDraftFromRaw(raw, "session:new", NOW + 2)?.text).toBe("首条消息前");
  });

  it("does not overwrite a newer target during migration", () => {
    const provisional = "pane:pane-1:avatar:meta";
    let raw = writeComposerDraftToRaw(null, provisional, draft("旧 provisional"), NOW);
    raw = writeComposerDraftToRaw(raw, "session:new", draft("较新的正式草稿"), NOW + 10);
    raw = migrateComposerDraftInRaw(raw, provisional, "session:new", NOW + 20);

    expect(readComposerDraftFromRaw(raw, provisional, NOW + 21)).toBeNull();
    expect(readComposerDraftFromRaw(raw, "session:new", NOW + 21)?.text).toBe("较新的正式草稿");
  });

  it("round-trips quote, reference, and attachment metadata", () => {
    const raw = writeComposerDraftToRaw(
      null,
      "session:A",
      draft("请看 @README.md [[agx-quote:q1]]", {
        attachments: [
          {
            key: "/repo/README.md",
            name: "README.md",
            size: 42,
            mimeType: "text/plain",
            status: "ready",
            content: "hello",
            sourcePath: "/repo/README.md",
            referenceToken: true,
            composerRefLabel: "README.md",
          },
        ],
        quotes: [
          {
            id: "q1",
            body: "引用正文",
            message: {
              id: "m1",
              role: "assistant",
              content: "完整回答",
              avatarName: "Near",
            },
          },
        ],
        refPaths: { "README.md": "/repo/README.md" },
        refMetaOverrides: {
          "README.md": {
            sourcePath: "/repo/README.md",
            composerRefLabel: "README.md",
          },
        },
      }),
      NOW,
    );
    const restored = readComposerDraftFromRaw(raw, "session:A", NOW + 1);

    expect(restored?.attachments[0]).toMatchObject({
      key: "/repo/README.md",
      sourcePath: "/repo/README.md",
      referenceToken: true,
    });
    expect(restored?.quotes[0]).toMatchObject({
      id: "q1",
      body: "引用正文",
      message: { id: "m1", role: "assistant", avatarName: "Near" },
    });
    expect(restored?.refPaths).toEqual({ "README.md": "/repo/README.md" });
  });

  it("drops duplicate binary for path-backed images", () => {
    const raw = writeComposerDraftToRaw(
      null,
      "session:image",
      draft("", {
        attachments: [
          {
            key: "/tmp/image.png",
            name: "image.png",
            size: 12,
            mimeType: "image/png",
            status: "ready",
            content: "[图片: image.png]",
            sourcePath: "/tmp/image.png",
            dataUrl: "data:image/png;base64,abc",
          },
        ],
      }),
      NOW,
    );
    const restored = readComposerDraftFromRaw(raw, "session:image", NOW + 1);

    expect(restored?.attachments[0].sourcePath).toBe("/tmp/image.png");
    expect(restored?.attachments[0].dataUrl).toBeUndefined();
  });

  it("preserves text and records an oversized pathless attachment as omitted", () => {
    const hugeDataUrl =
      "data:image/png;base64," + "a".repeat(COMPOSER_DRAFT_MAX_INLINE_DATA_URL_CHARS + 1);
    const raw = writeComposerDraftToRaw(
      null,
      "session:image",
      draft("正文不能丢", {
        attachments: [
          {
            key: "clipboard.png:1",
            name: "clipboard.png",
            size: hugeDataUrl.length,
            mimeType: "image/png",
            status: "ready",
            content: "[图片: clipboard.png]",
            dataUrl: hugeDataUrl,
          },
        ],
      }),
      NOW,
    );
    const restored = readComposerDraftFromRaw(raw, "session:image", NOW + 1);

    expect(restored?.text).toBe("正文不能丢");
    expect(restored?.attachments).toEqual([]);
    expect(restored?.omittedAttachmentNames).toEqual(["clipboard.png"]);
  });

  it("keeps the protected draft text inside the total collection budget", () => {
    const quotes = Array.from({ length: 24 }, (_, index) => ({
      id: `q-${index}`,
      body: "引".repeat(32_000),
      message: {
        id: `m-${index}`,
        role: "assistant" as const,
        content: "答".repeat(32_000),
      },
    }));
    const refMetaOverrides = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [
        `ref-${index}`,
        {
          sourcePath: `/tmp/${"p".repeat(3_000)}/${index}`,
          htmlElementRef: {
            tagName: "div",
            selectorHint: `#node-${index}`,
            comment: "评".repeat(32_000),
          },
        },
      ]),
    );
    const attachments = [
      {
        key: "clipboard-large.png",
        name: "clipboard-large.png",
        size: COMPOSER_DRAFT_MAX_INLINE_DATA_URL_CHARS,
        mimeType: "image/png",
        status: "ready" as const,
        content: "[图片: clipboard-large.png]",
        dataUrl:
          "data:image/png;base64," +
          "a".repeat(COMPOSER_DRAFT_MAX_INLINE_DATA_URL_CHARS - 64),
      },
    ];
    const raw = writeComposerDraftToRaw(
      null,
      "session:large",
      draft("必须保留的正文", { attachments, quotes, refMetaOverrides }),
      NOW,
    );

    expect(raw.length).toBeLessThanOrEqual(COMPOSER_DRAFT_MAX_STORE_CHARS);
    const restored = readComposerDraftFromRaw(raw, "session:large", NOW + 1);
    expect(restored?.text).toBe("必须保留的正文");
    expect(restored?.omittedAttachmentNames).toContain("clipboard-large.png");
  });

  it("expires stale drafts and retains only the newest entry budget", () => {
    let raw: string | null = null;
    for (let index = 0; index < COMPOSER_DRAFT_MAX_ENTRIES + 5; index += 1) {
      raw = writeComposerDraftToRaw(
        raw,
        `session:${index}`,
        draft(`draft-${index}`),
        NOW + index,
      );
    }
    const parsed = parseComposerDraftCollection(raw, NOW + COMPOSER_DRAFT_MAX_ENTRIES + 10);
    expect(Object.keys(parsed.drafts)).toHaveLength(COMPOSER_DRAFT_MAX_ENTRIES);
    expect(parsed.drafts["session:0"]).toBeUndefined();
    expect(parsed.drafts[`session:${COMPOSER_DRAFT_MAX_ENTRIES + 4}`]?.text).toBe(
      `draft-${COMPOSER_DRAFT_MAX_ENTRIES + 4}`,
    );

    const staleRaw = writeComposerDraftToRaw(
      null,
      "session:stale",
      draft("过期"),
      NOW - COMPOSER_DRAFT_TTL_MS - 1,
    );
    expect(readComposerDraftFromRaw(staleRaw, "session:stale", NOW)).toBeNull();
  });

  it("removes a specific draft without disturbing siblings", () => {
    let raw = writeComposerDraftToRaw(null, "session:A", draft("A"), NOW);
    raw = writeComposerDraftToRaw(raw, "session:B", draft("B"), NOW + 1);
    raw = removeComposerDraftFromRaw(raw, "session:A", NOW + 2);

    expect(readComposerDraftFromRaw(raw, "session:A", NOW + 3)).toBeNull();
    expect(readComposerDraftFromRaw(raw, "session:B", NOW + 3)?.text).toBe("B");
  });
});
