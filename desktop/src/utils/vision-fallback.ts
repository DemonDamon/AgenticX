/** Vision fallback availability for text-only chat models (short-TTL cached). */

import { studioFetch } from "./studio-fetch";

export interface VisionFallbackInfo {
  available: boolean;
  provider?: string;
  model?: string;
  label?: string;
}

const TTL_MS = 30_000;
let cache: { at: number; value: VisionFallbackInfo } | null = null;

export async function getVisionFallbackInfo(
  opts: { apiToken?: string; force?: boolean } = {},
): Promise<VisionFallbackInfo> {
  if (!opts.force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const resp = await studioFetch("/api/vision/fallback", { apiToken: opts.apiToken });
    const data = (await resp.json()) as Partial<VisionFallbackInfo> & { ok?: boolean };
    const value: VisionFallbackInfo = {
      available: Boolean(resp.ok && data.ok && data.available),
      provider: data.provider,
      model: data.model,
      label: data.label,
    };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return cache?.value ?? { available: false };
  }
}

export function invalidateVisionFallbackCache(): void {
  cache = null;
}
