import type { SearchReference } from "../types/search-references";
import { useAppStore } from "../store";

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

/** Open settings → knowledge tab; optional toast when document highlight is unavailable. */
export function openKbReference(ref: SearchReference): void {
  const parsed = parseKbReferenceUrl(ref.url);
  const title = String(ref.title || parsed?.docId || "知识库文档").trim();
  useAppStore.getState().openSettings("knowledge");
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("agx:kb-reference-open", {
        detail: { docId: parsed?.docId ?? "", title },
      }),
    );
  }
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
