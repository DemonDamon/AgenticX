import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPOSER_DRAFT_STORAGE_KEY,
  MAX_COMPOSER_DRAFT_ENTRIES,
  clearComposerDraft,
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

  it("parseComposerDrafts rejects bad payloads", () => {
    expect(parseComposerDrafts(null)).toEqual({});
    expect(parseComposerDrafts("{")).toEqual({});
    expect(parseComposerDrafts(JSON.stringify({ version: 2, drafts: {} }))).toEqual({});
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
    ).toEqual({ "session:b": { text: "ok", updatedAt: 2 } });
  });

  it("upsert / get / clear round-trip via scoped localStorage", () => {
    upsertComposerDraft("session:s1", "看下 f6e0cc77");
    expect(getComposerDraftText("session:s1")).toBe("看下 f6e0cc77");
    const raw = window.localStorage.getItem(scopedKey(COMPOSER_DRAFT_STORAGE_KEY));
    expect(raw).toContain("看下 f6e0cc77");
    clearComposerDraft("session:s1");
    expect(getComposerDraftText("session:s1")).toBe("");
  });

  it("blank upsert clears the slot", () => {
    upsertComposerDraft("pane:p1", "draft");
    upsertComposerDraft("pane:p1", "  \n");
    expect(getComposerDraftText("pane:p1")).toBe("");
  });

  it("migrateActiveComposerDraftToSession moves pane draft onto session", () => {
    upsertComposerDraft("pane:pane-x", "pending send");
    migrateActiveComposerDraftToSession("pane-x", "sess-new");
    expect(getComposerDraftText("pane:pane-x")).toBe("");
    expect(getComposerDraftText("session:sess-new")).toBe("pending send");
  });

  it("serialize prunes to MAX_COMPOSER_DRAFT_ENTRIES by updatedAt", () => {
    const drafts: Record<string, { text: string; updatedAt: number }> = {};
    for (let i = 0; i < MAX_COMPOSER_DRAFT_ENTRIES + 5; i += 1) {
      drafts[`session:s${i}`] = { text: `t${i}`, updatedAt: i + 1 };
    }
    const parsed = parseComposerDrafts(serializeComposerDrafts(drafts));
    expect(Object.keys(parsed)).toHaveLength(MAX_COMPOSER_DRAFT_ENTRIES);
    expect(parsed["session:s0"]).toBeUndefined();
    expect(parsed[`session:s${MAX_COMPOSER_DRAFT_ENTRIES + 4}`]?.text).toBe(
      `t${MAX_COMPOSER_DRAFT_ENTRIES + 4}`,
    );
  });
});
