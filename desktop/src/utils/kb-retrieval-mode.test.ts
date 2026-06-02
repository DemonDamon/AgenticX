import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampKbRetrievalMode,
  getKbRetrievalModeForPane,
  getSessionKbRetrievalMode,
  kbRetrievalPanePendingKey,
  migratePaneKbRetrievalModeToSession,
  setKbRetrievalModeForPane,
  setSessionKbRetrievalMode,
} from "./kb-retrieval-mode";

// vitest runs in node here (no jsdom): provide a minimal in-memory localStorage
// on a stubbed `window` so the module's storage path is exercised.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const fakeWindow = { localStorage: new MemoryStorage() };
vi.stubGlobal("window", fakeWindow);

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("clampKbRetrievalMode", () => {
  it("keeps always", () => {
    expect(clampKbRetrievalMode("always")).toBe("always");
  });

  it("folds auto/manual/unknown into auto", () => {
    expect(clampKbRetrievalMode("auto")).toBe("auto");
    expect(clampKbRetrievalMode("manual")).toBe("auto");
    expect(clampKbRetrievalMode("")).toBe("auto");
    expect(clampKbRetrievalMode(undefined)).toBe("auto");
  });
});

describe("per-session storage", () => {
  beforeEach(() => {
    fakeWindow.localStorage.clear();
  });

  it("returns null when no explicit choice exists", () => {
    expect(getSessionKbRetrievalMode("sess-a")).toBeNull();
  });

  it("persists and reads back a per-session choice", () => {
    setSessionKbRetrievalMode("sess-a", "always");
    expect(getSessionKbRetrievalMode("sess-a")).toBe("always");
  });

  it("keeps sessions independent — no cross-session leak", () => {
    setSessionKbRetrievalMode("sess-a", "always");
    setSessionKbRetrievalMode("sess-b", "auto");
    expect(getSessionKbRetrievalMode("sess-a")).toBe("always");
    expect(getSessionKbRetrievalMode("sess-b")).toBe("auto");
  });

  it("ignores empty sessionId on read and write", () => {
    setSessionKbRetrievalMode("", "always");
    expect(getSessionKbRetrievalMode("")).toBeNull();
  });

  it("clamps stored value on write", () => {
    setSessionKbRetrievalMode("sess-a", "manual" as unknown as "auto");
    expect(getSessionKbRetrievalMode("sess-a")).toBe("auto");
  });

  it("stores lazy fresh pane choice before session id exists", () => {
    setKbRetrievalModeForPane("", "pane-1", "auto");
    expect(getKbRetrievalModeForPane("", "pane-1")).toBe("auto");
    expect(getSessionKbRetrievalMode("")).toBeNull();
  });

  it("migrates pane pending choice to real session on first send", () => {
    setKbRetrievalModeForPane("", "pane-1", "auto");
    migratePaneKbRetrievalModeToSession("pane-1", "sess-new");
    expect(getSessionKbRetrievalMode("sess-new")).toBe("auto");
    expect(getSessionKbRetrievalMode(kbRetrievalPanePendingKey("pane-1"))).toBeNull();
  });
});
