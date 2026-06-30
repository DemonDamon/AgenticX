/** Shared renderer fetch helpers for agx serve (absolute URL, readiness, timeout). */

export const STUDIO_FETCH_TIMEOUT_MS = 20_000;

export async function resolveStudioApiBase(storeBase?: string): Promise<string> {
  const trimmed = (storeBase ?? "").trim();
  if (trimmed) return trimmed.replace(/\/+$/, "");
  const raw = String((await window.agenticxDesktop.getApiBase()) || "").trim();
  if (!raw) {
    throw new Error("Studio 未连接");
  }
  return raw.replace(/\/+$/, "");
}

export async function waitStudioReady(timeoutMs = 60_000): Promise<boolean> {
  try {
    const res = await window.agenticxDesktop.waitForStudio(timeoutMs);
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

export async function studioFetch(
  path: string,
  init: RequestInit & { apiToken?: string; storeBase?: string } = {},
): Promise<Response> {
  await waitStudioReady();
  const base = await resolveStudioApiBase(init.storeBase);
  const headers = new Headers(init.headers ?? undefined);
  if (init.apiToken) {
    headers.set("x-agx-desktop-token", init.apiToken);
  }
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const { apiToken: _t, storeBase: _b, ...rest } = init;
  return fetch(`${base}${normalized}`, {
    ...rest,
    headers,
    signal: rest.signal ?? AbortSignal.timeout(STUDIO_FETCH_TIMEOUT_MS),
  });
}
