import type { SearchReference } from "../types/search-references";
import { openKbDocumentFromReference } from "./open-kb-document";

/** Parse `agx://kb/{docId}#{chunk}` style URLs. */
export function parseKbReferenceUrl(url: string): { docId: string; chunk?: string } | null {
  const href = String(url ?? "").trim();
  if (!href.startsWith("agx://kb/")) return null;
  const rest = href.slice("agx://kb/".length);
  const hashIdx = rest.indexOf("#");
  const docId = (hashIdx >= 0 ? rest.slice(0, hashIdx) : rest).trim();
  if (!docId || docId === "unknown") return null;
  const chunk = hashIdx >= 0 ? rest.slice(hashIdx + 1).trim() : undefined;
  return { docId, chunk: chunk || undefined };
}

/** Open the KB source file in the system default app (with loading overlay). */
export function openKbReference(ref: SearchReference): void {
  void openKbDocumentFromReference(ref);
}

export function openSearchReference(ref: SearchReference): void {
  if (/^https?:\/\//i.test(ref.url)) {
    void import("./open-external").then(({ openExternalUrl }) => openExternalUrl(ref.url));
    return;
  }
  if (ref.source === "kb" || ref.url.startsWith("agx://kb/")) {
    openKbReference(ref);
  }
}
