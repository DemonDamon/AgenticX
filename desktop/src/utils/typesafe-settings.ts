export type TypesafePublicSettings = {
  enabled: boolean;
  has_key: boolean;
  model: string;
  timeout_sec: number;
  group_routing: boolean;
  kb_auto: boolean;
  show_decision_card: boolean;
  act_above: number;
  review_above: number;
};

export const DEFAULT_TYPESAFE_PUBLIC_SETTINGS: TypesafePublicSettings = {
  enabled: false,
  has_key: false,
  model: "jev-latest",
  timeout_sec: 8,
  group_routing: true,
  kb_auto: false,
  show_decision_card: true,
  act_above: 0.8,
  review_above: 0.5,
};

export function parseTypesafePublicSettings(raw: unknown): TypesafePublicSettings {
  const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    enabled: rec.enabled === true,
    has_key: rec.has_key === true,
    model: String(rec.model ?? "jev-latest").trim() || "jev-latest",
    timeout_sec: Number(rec.timeout_sec ?? 8) || 8,
    group_routing: rec.group_routing !== false,
    kb_auto: rec.kb_auto === true,
    show_decision_card: rec.show_decision_card !== false,
    act_above: Number(rec.act_above ?? 0.8) || 0.8,
    review_above: Number(rec.review_above ?? 0.5) || 0.5,
  };
}

export async function fetchTypesafeSettings(
  apiBase: string,
  apiToken: string,
): Promise<TypesafePublicSettings> {
  const base = String(apiBase ?? "").replace(/\/$/, "");
  if (!base) return DEFAULT_TYPESAFE_PUBLIC_SETTINGS;
  const resp = await fetch(`${base}/api/typesafe/settings`, {
    headers: { "x-agx-desktop-token": apiToken },
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  return parseTypesafePublicSettings(await resp.json());
}
