/**
 * Aggregate skills + search references for WorkPanel「参考信息」(Trae-style).
 *
 * Sources:
 * - assistant / tool rows with `references` / `searchedQueries`
 * - knowledge_search tool JSON fallback (when SSE structured payload was missed)
 * - skill_use toolArgs.name + @skill:// tokens in user text
 *
 * Author: Damon Li
 */

import type { Message } from "../store";
import {
  mergeSearchReferences,
  mergeSearchedQueries,
  type SearchReference,
} from "../types/search-references";
import { dedupeReferencesByDoc, type DocGroup } from "./citation-doc-grouping";
import { parseKbReferencesFromToolResult } from "./search-reference-sse";

const SKILL_TOKEN_RE = /@skill:\/\/([^\s`<>"'）】\]]+)/gi;

export type SessionSkillRef = {
  name: string;
};

export type SessionReferenceBundle = {
  skills: SessionSkillRef[];
  webGroups: DocGroup[];
  kbGroups: DocGroup[];
  searchedQueries: string[];
  /** Total unique docs (web + kb). */
  docCount: number;
  skillCount: number;
  isEmpty: boolean;
};

function refsFromToolMessage(msg: Message): SearchReference[] {
  if (msg.role !== "tool") return [];
  const name = String(msg.toolName ?? "").trim();
  if (name !== "knowledge_search") return [];
  return parseKbReferencesFromToolResult(msg.content);
}

function collectSkillNames(messages: Message[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const name = String(raw ?? "").trim();
    if (!name) return;
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };

  for (const message of messages) {
    if (message.role === "tool" && String(message.toolName ?? "").trim() === "skill_use") {
      add(String(message.toolArgs?.name ?? "").trim());
      continue;
    }
    if (message.role === "user") {
      SKILL_TOKEN_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = SKILL_TOKEN_RE.exec(message.content)) !== null) {
        add(match[1] ?? "");
      }
    }
  }
  return out;
}

/** Collect session-level skills + web/kb docs for the WorkPanel refs section. */
export function collectSessionReferences(messages: Message[]): SessionReferenceBundle {
  let refs: SearchReference[] = [];
  let queries: string[] = [];

  for (const message of messages) {
    if ((message.references?.length ?? 0) > 0) {
      refs = mergeSearchReferences(refs, message.references ?? []);
    }
    if ((message.searchedQueries?.length ?? 0) > 0) {
      queries = mergeSearchedQueries(queries, message.searchedQueries ?? []);
    }
    if (message.role === "tool") {
      refs = mergeSearchReferences(refs, refsFromToolMessage(message));
      if (String(message.toolName ?? "").trim() === "web_search") {
        const q = String(message.toolArgs?.query ?? "").trim();
        if (q) queries = mergeSearchedQueries(queries, [q]);
      }
      if (String(message.toolName ?? "").trim() === "knowledge_search") {
        const q = String(message.toolArgs?.query ?? "").trim();
        if (q) queries = mergeSearchedQueries(queries, [q]);
      }
    }
  }

  const docGroups = dedupeReferencesByDoc(refs);
  const webGroups = docGroups.filter((g) => g.primary.source === "web");
  const kbGroups = docGroups.filter((g) => g.primary.source === "kb");
  const skills = collectSkillNames(messages).map((name) => ({ name }));

  return {
    skills,
    webGroups,
    kbGroups,
    searchedQueries: queries,
    docCount: docGroups.length,
    skillCount: skills.length,
    isEmpty: skills.length === 0 && docGroups.length === 0,
  };
}
