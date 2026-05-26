import { LEGACY_META_DISPLAY_NAMES, META_AGENT_DISPLAY_NAME } from "../constants/branding";

export function resolveMetaDisplayName(raw?: string | null): string {
  const t = (raw ?? "").trim();
  if (!t || t === "分身" || LEGACY_META_DISPLAY_NAMES.has(t)) {
    return META_AGENT_DISPLAY_NAME;
  }
  return t;
}

/** Runtime agent_id for Near / meta-leader (group router uses `__meta__`). */
export function isMetaLeaderAgentId(agentId?: string | null): boolean {
  const aid = String(agentId ?? "").trim().toLowerCase();
  return aid === "meta" || aid === "__meta__";
}

export function isLegacyMetaDisplayName(name?: string | null): boolean {
  const t = (name ?? "").trim();
  return LEGACY_META_DISPLAY_NAMES.has(t);
}

/** Whether a persisted or live message row belongs to Near (meta-leader), not a member avatar. */
export function isMetaLeaderIdentity(agentId?: string | null, displayName?: string | null): boolean {
  return isMetaLeaderAgentId(agentId) || isLegacyMetaDisplayName(displayName);
}
