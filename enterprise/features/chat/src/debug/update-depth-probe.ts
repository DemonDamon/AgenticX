const STORAGE_KEY = "agx.debugUpdateDepth";
const QUERY_KEY = "agxUpdateDepthProbe";
const RING_LIMIT = 200;

export type UpdateDepthProbeEntry = {
  t: number;
  source: string;
  detail?: Record<string, unknown>;
};

const ring: UpdateDepthProbeEntry[] = [];
let lastConsoleAt = 0;

function readQueryFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get(QUERY_KEY) === "1";
  } catch {
    return false;
  }
}

function readStorageFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Probe is off by default — zero cost on production paths when disabled. */
export function isUpdateDepthProbeEnabled(): boolean {
  return readStorageFlag() || readQueryFlag();
}

export function probeNote(source: string, detail?: Record<string, unknown>): void {
  if (!isUpdateDepthProbeEnabled()) return;
  const entry: UpdateDepthProbeEntry = {
    t: Date.now(),
    source,
    ...(detail ? { detail } : {}),
  };
  ring.push(entry);
  if (ring.length > RING_LIMIT) {
    ring.splice(0, ring.length - RING_LIMIT);
  }
  const now = Date.now();
  if (now - lastConsoleAt >= 250) {
    lastConsoleAt = now;
    // eslint-disable-next-line no-console
    console.debug("[agx.updateDepthProbe]", entry);
  }
}

export function getUpdateDepthProbeBuffer(): readonly UpdateDepthProbeEntry[] {
  return ring;
}

export function clearUpdateDepthProbeBuffer(): void {
  ring.length = 0;
  lastConsoleAt = 0;
}

/** Test helper — do not use in product UI. */
export function __resetUpdateDepthProbeForTests(): void {
  clearUpdateDepthProbeBuffer();
}
