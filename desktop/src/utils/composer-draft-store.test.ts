import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPOSER_DRAFT_STORAGE_KEY,
  MAX_COMPOSER_DRAFT_ENTRIES,
  clearComposerDraft,
  getComposerDraft,
  getComposerDraftAttachments,
  getComposerDraftText,
  migrateActiveComposerDraftToSession,
  parseComposerDrafts,
  resolveComposerDraftKey,
  serializeComposerDrafts,
  upsertComposerDraft,
} from "./composer-draft-store";
import { scopedKey } from "./backend-scope";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("composer-draft-store", () => {
  beforeEach(() => {
    const localStorage = new MemoryStorage();
    vi.stubGlobal("window", {
      localStorage,
      agenticxDesktop: { getBackendScopeSync: () => "local" },
    } as unknown as Window);
  });

  it("resolveComposerDraftKey prefers session then pane", () => {
    expect(resolveComposerDraftKey("pane-1", "sess-a")).toBe("session:sess-a");
    expect(resolveComposerDraftKey("pane-1", "  ")).toBe("pane:pane-1");
    expect(resolveComposerDraftKey("pane-1", null)).toBe("pane:pane-1");
  });

  it("parseComposerDrafts rejects bad payloads and accepts v1/v2", () => {
    expect(parseComposerDrafts(null)).toEqual({});
    expect(parseComposerDrafts("{")).toEqual({});
    expect(parseComposerDrafts(JSON.stringify({ version: 99, drafts: {} }))).toEqual({});
    expect(
      parseComposerDrafts(
        JSON.stringify({
          version: 1,
          drafts: {
            "session:a": { text: "   ", updatedAt: 1 },
            "session:b": { text: "ok", updatedAt: 2 },
          },
        }),
      ),
    ).toEqual({ "session:b": { text: "ok", attachments: [], updatedAt: 2 } });
  });

  it("upsert / get / clear round-trip via scoped localStorage", () => {
    upsertComposerDraft("session:s1", "看下 f6e0cc77");
    expect(getComposerDraftText("session:s1")).toBe("看下 f6e0cc77");
    const raw = window.localStorage.getItem(scopedKey(COMPOSER_DRAFT_STORAGE_KEY));
    expect(raw).toContain("看下 f6e0cc77");
    clearComposerDraft("session:s1");
    expect(getComposerDraftText("session:s1")).toBe("");
  });

  it("persists image attachments with dataUrl", () => {
    const dataUrl = "data:image/png;base64,aaaa";
    upsertComposerDraft("session:img", "带图", [
      {
        key: "img-1",
        name: "image.png",
        size: 12,
        mimeType: "image/png",
        status: "ready",
        content: "[图片: image.png]",
        dataUrl,
      },
    ]);
    expect(getComposerDraftText("session:img")).toBe("带图");
    const atts = getComposerDraftAttachments("session:img");
    expect(atts).toHaveLength(1);
    expect(atts[0]?.name).toBe("image.png");
    expect(atts[0]?.dataUrl).toBe(dataUrl);
    expect(getComposerDraft("session:img")?.attachments[0]?.mimeType).toBe("image/png");
    // localStorage must stay metadata-only (no embedded dataUrl payload).
    const raw = window.localStorage.getItem(scopedKey(COMPOSER_DRAFT_STORAGE_KEY)) || "";
    expect(raw).not.toContain("data:image/png;base64,aaaa");
    expect(raw).toContain('"hasBlob":true');
  });

  it("keeps oversized image payloads via blob store (not dropped)", () => {
    const dataUrl = `data:image/png;base64,${"A".repeat(80_000)}`;
    upsertComposerDraft("session:big", "大图", [
      {
        key: "big-1",
        name: "big.png",
        size: 60_000,
        mimeType: "image/png",
        status: "ready",
        content: "[图片: big.png]",
        dataUrl,
      },
    ]);
    const atts = getComposerDraftAttachments("session:big");
    expect(atts).toHaveLength(1);
    expect(atts[0]?.dataUrl).toBe(dataUrl);
    const raw = window.localStorage.getItem(scopedKey(COMPOSER_DRAFT_STORAGE_KEY)) || "";
    expect(raw.length).toBeLessThan(20_000);
    expect(raw).not.toContain(dataUrl.slice(0, 40));
  });

  it("attachment-only draft is kept; blank clears", () => {
    upsertComposerDraft("pane:p1", "", [
      {
        key: "img-1",
        name: "a.png",
        size: 1,
        mimeType: "image/png",
        status: "ready",
        content: "[图片]",
        dataUrl: "data:image/png;base64,x",
      },
    ]);
    expect(getComposerDraftAttachments("pane:p1")).toHaveLength(1);
    upsertComposerDraft("pane:p1", "  \n", []);
    expect(getComposerDraft("pane:p1")).toBeNull();
  });

  it("blank upsert clears the slot", () => {
    upsertComposerDraft("pane:p1", "draft");
    upsertComposerDraft("pane:p1", "  \n");
    expect(getComposerDraftText("pane:p1")).toBe("");
  });

  it("migrateActiveComposerDraftToSession moves pane draft onto session", () => {
    upsertComposerDraft("pane:pane-x", "pending send", [
      {
        key: "f1",
        name: "a.png",
        size: 1,
        mimeType: "image/png",
        status: "ready",
        content: "[图片]",
        dataUrl: "data:image/png;base64,y",
      },
    ]);
    migrateActiveComposerDraftToSession("pane-x", "sess-new");
    expect(getComposerDraftText("pane:pane-x")).toBe("");
    expect(getComposerDraftText("session:sess-new")).toBe("pending send");
    expect(getComposerDraftAttachments("session:sess-new")[0]?.name).toBe("a.png");
  });

  it("serialize prunes to MAX_COMPOSER_DRAFT_ENTRIES by updatedAt", () => {
    const drafts: Record<string, { text: string; attachments: []; updatedAt: number }> = {};
    for (let i = 0; i < MAX_COMPOSER_DRAFT_ENTRIES + 5; i += 1) {
      drafts[`session:s${i}`] = { text: `t${i}`, attachments: [], updatedAt: i + 1 };
    }
    const parsed = parseComposerDrafts(serializeComposerDrafts(drafts));
    expect(Object.keys(parsed)).toHaveLength(MAX_COMPOSER_DRAFT_ENTRIES);
    expect(parsed["session:s0"]).toBeUndefined();
    expect(parsed[`session:s${MAX_COMPOSER_DRAFT_ENTRIES + 4}`]?.text).toBe(
      `t${MAX_COMPOSER_DRAFT_ENTRIES + 4}`,
    );
  });
});
