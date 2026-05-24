import { LEGACY_META_DISPLAY_NAMES, META_AGENT_DISPLAY_NAME } from "../constants/branding";

export function resolveMetaDisplayName(raw?: string | null): string {
  const t = (raw ?? "").trim();
  if (!t || t === "分身" || LEGACY_META_DISPLAY_NAMES.has(t)) {
    return META_AGENT_DISPLAY_NAME;
  }
  return t;
}
