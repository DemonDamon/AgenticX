/**
 * Pace a live reply one segment at a time so dumps don't paint as a block.
 * Author: Damon Li
 */

export const STREAM_WORD_MS = 16;
const CATCH_UP_AFTER = 32;

export function prefersStreamReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function segmentStreamText(source: string): string[] {
  const text = String(source ?? "");
  if (!text) return [];
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    return Array.from(segmenter.segment(text), (part) => part.segment);
  }
  return text.match(/\s+|[^\s]+/g) ?? [text];
}

export function joinStreamSegments(segments: readonly string[], count: number): string {
  if (count <= 0) return "";
  if (count >= segments.length) return segments.join("");
  return segments.slice(0, count).join("");
}

export function pacedRevealStep(pending: number): number {
  if (pending <= 0) return 0;
  if (pending > CATCH_UP_AFTER * 4) return Math.ceil(pending / 3);
  if (pending > CATCH_UP_AFTER) return 2;
  return 1;
}

export function nextPacedCount(current: number, total: number): number {
  if (total <= 0) return 0;
  const safe = Math.max(0, Math.min(current, total));
  return Math.min(total, safe + pacedRevealStep(total - safe));
}
