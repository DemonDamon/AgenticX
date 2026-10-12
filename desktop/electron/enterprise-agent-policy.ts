/**
 * Normalize the enterprise agent-action policy before it is written into
 * the local AgenticX config. The on-disk shape is snake_case; bootstrap
 * payloads use camelCase. Both are accepted.
 */

const MAX_PATTERNS = 100;
const PATTERN = /^[A-Za-z0-9_:*./-]{1,128}$/;

export type NormalizedAgentActionPolicy = {
  denied_tools: string[];
  always_ask_tools: string[];
  disable_session_allow: boolean;
};

function readList(source: Record<string, unknown>, camel: string, snake: string): unknown {
  if (camel in source) return source[camel];
  if (snake in source) return source[snake];
  return undefined;
}

function readFlag(source: Record<string, unknown>): boolean {
  if ("disableSessionAllow" in source) return source.disableSessionAllow === true;
  if ("disable_session_allow" in source) return source.disable_session_allow === true;
  return false;
}

function normalizePatterns(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (!PATTERN.test(text)) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= MAX_PATTERNS) break;
  }
  return out;
}

export function normalizeAgentActionPolicy(raw: unknown): NormalizedAgentActionPolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { denied_tools: [], always_ask_tools: [], disable_session_allow: false };
  }
  const source = raw as Record<string, unknown>;
  return {
    denied_tools: normalizePatterns(readList(source, "deniedTools", "denied_tools")),
    always_ask_tools: normalizePatterns(readList(source, "alwaysAskTools", "always_ask_tools")),
    disable_session_allow: readFlag(source),
  };
}
