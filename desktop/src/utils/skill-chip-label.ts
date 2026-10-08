/**
 * Display labels for official bundled skills in `@skill://slug` chips.
 * The serialized token stays the slug (backend `skill_slugs` resolves by name);
 * only the visible chip text is localized.
 */
import { i18n } from "../i18n/i18n";

/** Bundled skill: 连接器助手 (agenticx/skills/connector-assistant). */
export const CONNECTOR_ASSISTANT_SKILL_SLUG = "connector-assistant";

const OFFICIAL_SKILL_LABELS: Record<string, { zh: string; en: string }> = {
  [CONNECTOR_ASSISTANT_SKILL_SLUG]: { zh: "连接器助手", en: "Connector Assistant" },
};

export function skillChipLabel(slug: string, language?: string): string {
  const entry = OFFICIAL_SKILL_LABELS[String(slug ?? "").trim()];
  if (!entry) return slug;
  const lang = (language ?? i18n.language ?? "zh").toLowerCase();
  return lang.startsWith("en") ? entry.en : entry.zh;
}

/** Composer draft that pins a skill chip before the prompt text. */
export function skillDraft(slug: string, text: string): string {
  const body = String(text ?? "").trim();
  return body ? `@skill://${slug} ${body}` : `@skill://${slug} `;
}
