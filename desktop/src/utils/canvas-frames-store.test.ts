import { describe, expect, it } from "vitest";
import { loadCanvasFrames, saveCanvasFrames, type StoredCanvasFrame } from "./canvas-frames-store";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => data.delete(key),
    setItem: (key, value) => data.set(key, value),
  };
}

describe("canvas frame persistence", () => {
  it("restores a session after the in-memory map is gone", () => {
    const storage = memoryStorage();
    const frames: StoredCanvasFrame[] = [
      {
        id: "page-dashboard",
        title: "项目总览",
        absolutePath: "/work/pages/dashboard.html",
        device: "desktop",
        x: 20,
        y: 40,
        reloadNonce: 3,
      },
    ];
    saveCanvasFrames("session-a", frames, storage);
    saveCanvasFrames("session-b", [], storage);
    expect(loadCanvasFrames("session-a", storage)).toEqual([
      { ...frames[0], kind: "html", reloadNonce: 0, incomplete: undefined },
    ]);
    expect(loadCanvasFrames("session-b", storage)).toEqual([]);
    expect(loadCanvasFrames("missing", storage)).toEqual([]);
  });
});
