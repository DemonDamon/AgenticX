/**
 * Persist design-canvas frames per session so a restart restores the layout.
 *
 * Author: Damon Li
 */

const STORAGE_KEY = "agx-canvas-frames-v1";

export type StoredCanvasFrame = {
  id: string;
  title: string;
  absolutePath: string;
  kind?: "html" | "image";
  device: "desktop" | "tablet" | "phone";
  x: number;
  y: number;
  reloadNonce: number;
  incomplete?: boolean;
};

type StoreShape = Record<string, StoredCanvasFrame[]>;

function readAll(storage: Storage): StoreShape {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as StoreShape;
  } catch {
    return {};
  }
}

function sanitize(frames: StoredCanvasFrame[]): StoredCanvasFrame[] {
  return frames
    .filter((frame) => frame && typeof frame.id === "string" && typeof frame.absolutePath === "string")
    .map((frame) => ({
      id: frame.id,
      title: typeof frame.title === "string" ? frame.title : frame.id,
      absolutePath: frame.absolutePath,
      kind: frame.kind === "image" ? "image" : "html",
      device: frame.device === "tablet" || frame.device === "phone" ? frame.device : "desktop",
      x: typeof frame.x === "number" && Number.isFinite(frame.x) ? frame.x : 0,
      y: typeof frame.y === "number" && Number.isFinite(frame.y) ? frame.y : 0,
      reloadNonce: 0,
      incomplete: frame.incomplete === true ? true : undefined,
    }));
}

export function loadCanvasFrames(sessionId: string, storage: Storage = localStorage): StoredCanvasFrame[] {
  const sid = sessionId.trim();
  if (!sid) return [];
  const all = readAll(storage);
  const frames = all[sid];
  return Array.isArray(frames) ? sanitize(frames) : [];
}

export function saveCanvasFrames(
  sessionId: string,
  frames: StoredCanvasFrame[],
  storage: Storage = localStorage,
): void {
  const sid = sessionId.trim();
  if (!sid) return;
  const all = readAll(storage);
  all[sid] = sanitize(frames);
  storage.setItem(STORAGE_KEY, JSON.stringify(all));
}
