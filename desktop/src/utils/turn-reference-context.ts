import type { Message } from "../store";
import {
  mergeSearchReferences,
  parseKbReferencesFromToolResult,
  type SearchReference,
} from "./search-reference-sse";

/** Parse KB hits embedded in assistant prose (models that skip native tool_call UI). */
export function tryParseEmbeddedKbSearchJson(text: string): SearchReference[] {
  const raw = String(text ?? "");
  if (!raw.includes("hits")) return [];
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(raw)) !== null) {
    const refs = parseKbReferencesFromToolResult(m[1]);
    if (refs.length > 0) return refs;
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return parseKbReferencesFromToolResult(raw.slice(start, end + 1));
  }
  return [];
}

function refsFromToolMessage(msg: Message): SearchReference[] {
  if (msg.role !== "tool") return [];
  const name = String(msg.toolName ?? "").trim();
  if (name !== "knowledge_search" && name !== "web_search") return [];
  return parseKbReferencesFromToolResult(msg.content);
}

/**
 * Resolve citation sources for an assistant row from the same user turn:
 * message.references → preceding tool_result JSON → embedded JSON in assistant text.
 */
export function resolveReferencesForAssistant(
  assistantMsg: Message,
  allMessages: Message[],
): SearchReference[] {
  if ((assistantMsg.references?.length ?? 0) > 0) {
    return assistantMsg.references ?? [];
  }
  const idx = allMessages.findIndex((m) => m.id === assistantMsg.id);
  const scanFrom = idx >= 0 ? idx : allMessages.length;
  let collected: SearchReference[] = [];
  for (let i = scanFrom - 1; i >= 0; i--) {
    const m = allMessages[i];
    if (m.role === "user") break;
    if (m.role === "tool") {
      collected = mergeSearchReferences(collected, refsFromToolMessage(m));
    }
  }
  if (collected.length > 0) return collected;
  return tryParseEmbeddedKbSearchJson(assistantMsg.content);
}
