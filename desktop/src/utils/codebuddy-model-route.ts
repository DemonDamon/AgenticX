/**
 * Mirror of agenticx.wb_bridge.custom_model for desktop model picker UX.
 */

export const CODEBUDDY_CUSTOM_LOCAL_PREFIX = "custom-local:";

export type CodebuddyModelEntry = {
  id?: string;
  url?: string;
  apiKey?: string;
};

export function codebuddyModelEntryHasEndpoint(entry: CodebuddyModelEntry | undefined): boolean {
  if (!entry) return false;
  const url = String(entry.url ?? "").trim();
  const apiKey = String(entry.apiKey ?? "").trim();
  return Boolean(url && apiKey);
}

export function codebuddyModelUsesCustomLocal(
  modelId: string,
  catalog: CodebuddyModelEntry[],
): boolean {
  const raw = String(modelId ?? "").trim();
  if (!raw) return false;
  if (raw.startsWith(CODEBUDDY_CUSTOM_LOCAL_PREFIX)) return true;
  const hit = catalog.find((row) => String(row.id ?? "").trim() === raw);
  return codebuddyModelEntryHasEndpoint(hit);
}

export function parseCodebuddyModelsJson(text: string): CodebuddyModelEntry[] {
  try {
    const payload = JSON.parse(text) as { models?: unknown };
    if (!Array.isArray(payload?.models)) return [];
    return payload.models.filter(
      (row): row is CodebuddyModelEntry => typeof row === "object" && row !== null,
    );
  } catch {
    return [];
  }
}
