import type { Message } from "../store";
import type { SearchReference } from "../types/search-references";

const norm = (s: unknown) => String(s ?? "").trim();

/** When disk reload races ahead of persist, keep in-memory references on the matching assistant row. */
export function enrichDiskMessagesWithInMemoryReferences(
  current: Message[],
  diskMapped: Message[],
): Message[] {
  if (!diskMapped.length) return diskMapped;
  const curAssist = [...current].reverse().find((m) => m.role === "assistant");
  const memRefs = curAssist?.references;
  if (!memRefs?.length) return diskMapped;

  const curContent = norm(curAssist?.content);
  const out = diskMapped.map((row) => ({ ...row }));
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role !== "assistant") continue;
    const diskContent = norm(out[i].content);
    const diskHasRefs = (out[i].references?.length ?? 0) > 0;
    if (diskHasRefs) break;
    if (!curContent || curContent === diskContent) {
      out[i] = {
        ...out[i],
        references: memRefs,
        searchedQueries: curAssist?.searchedQueries?.length
          ? curAssist.searchedQueries
          : out[i].searchedQueries,
      };
    }
    break;
  }
  return out;
}

export function lastAssistantReferenceCount(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      return messages[i].references?.length ?? 0;
    }
  }
  return 0;
}

export function referencesDifferBetweenTails(a: Message[], b: Message[]): boolean {
  return lastAssistantReferenceCount(a) !== lastAssistantReferenceCount(b);
}
