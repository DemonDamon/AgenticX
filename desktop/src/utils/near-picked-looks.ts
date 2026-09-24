const PICKED_KEY = "agx-near-picked-looks";
const LIMIT = 12;

export type NearPickedLook = {
  style: string;
  key: string;
  options?: Record<string, string | string[] | boolean | number>;
};

function readAll(): NearPickedLook[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PICKED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as NearPickedLook[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && item.style && item.key);
  } catch {
    return [];
  }
}

export function listNearPickedLooks(style: string): NearPickedLook[] {
  return readAll().filter((item) => item.style === style);
}

export function rememberNearPickedLook(
  style: string,
  key: string,
  options?: Record<string, string | string[] | boolean | number>,
): void {
  const nextKey = key.trim();
  if (!style || !nextKey) return;
  const next = [
    { style, key: nextKey, ...(options && Object.keys(options).length > 0 ? { options } : {}) },
    ...readAll().filter((item) => !(item.style === style && item.key === nextKey)),
  ].slice(0, LIMIT);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PICKED_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}
