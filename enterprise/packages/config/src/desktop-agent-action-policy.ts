/**
 * Tenant-level policy for what an employee agent may execute on the desktop.
 *
 * Delivered with bootstrap. Patterns are matched case-insensitively with
 * fnmatch semantics against the tool name, `mcp:<tool>`, and `git:push`.
 */

export type DesktopAgentActionPolicy = {
  /** Tools the employee desktop must refuse outright. */
  deniedTools: string[];
  /** Tools that always require a human confirmation. Session allow and auto-run cannot skip them. */
  alwaysAskTools: string[];
  /** When true, "don't ask again this session" has no effect. */
  disableSessionAllow: boolean;
};

export const DEFAULT_DESKTOP_AGENT_ACTION_POLICY: DesktopAgentActionPolicy = {
  deniedTools: [],
  alwaysAskTools: [],
  disableSessionAllow: false,
};

const MAX_PATTERNS = 100;
const PATTERN = /^[A-Za-z0-9_:*./-]{1,128}$/;

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

export function normalizeDesktopAgentActionPolicy(raw: unknown): DesktopAgentActionPolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_DESKTOP_AGENT_ACTION_POLICY, deniedTools: [], alwaysAskTools: [] };
  }
  const source = raw as Record<string, unknown>;
  return {
    deniedTools: normalizePatterns(source.deniedTools),
    alwaysAskTools: normalizePatterns(source.alwaysAskTools),
    disableSessionAllow: source.disableSessionAllow === true,
  };
}
