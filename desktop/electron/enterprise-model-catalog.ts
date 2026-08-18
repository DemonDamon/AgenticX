export type EnterpriseModelCatalogEntry = {
  id: string;
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
  route?: "local" | "private-cloud" | "third-party";
  isDefault?: boolean;
  capabilities?: string[];
  /** 管理员在企业后台声明的上下文窗口；缺省时由后端按模型名兜底。 */
  contextWindow?: number;
};

const FALLBACK_PROVIDER_LABELS: Record<string, string> = {
  chinamobile: "移动云",
  cmcc: "移动云",
  kimi: "月之暗面",
  moonshot: "月之暗面",
  moma: "MOMA",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function inferProviderFromId(id: string): string {
  const slash = id.indexOf("/");
  return slash > 0 ? id.slice(0, slash).trim() : "enterprise";
}

function inferModelFromId(id: string): string {
  const slash = id.indexOf("/");
  return slash > 0 ? id.slice(slash + 1).trim() : id;
}

function fallbackProviderLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (!normalized || normalized === "enterprise") return "企业模型";
  return FALLBACK_PROVIDER_LABELS[normalized] ?? provider.trim();
}

/**
 * Preserve the provider metadata returned by the Enterprise bootstrap API.
 * Older Desktop configs only contain string ids; those are still accepted and
 * grouped by their first routing segment so upgrades do not require re-login.
 */
export function normalizeEnterpriseModelCatalog(value: unknown): EnterpriseModelCatalogEntry[] {
  if (!Array.isArray(value)) return [];
  const result: EnterpriseModelCatalogEntry[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const record = asRecord(item);
    const id = text(record?.id ?? item);
    if (!id || seen.has(id)) continue;

    const provider = text(record?.provider) || inferProviderFromId(id);
    const model = text(record?.model) || inferModelFromId(id);
    const providerLabel =
      text(record?.providerLabel ?? record?.provider_label) || fallbackProviderLabel(provider);
    const label = text(record?.label) || model;
    const rawRoute = text(record?.route);
    const route =
      rawRoute === "local" || rawRoute === "private-cloud" || rawRoute === "third-party"
        ? rawRoute
        : undefined;
    const rawContextWindow = record?.contextWindow ?? record?.context_window;
    const contextWindow =
      typeof rawContextWindow === "number" && Number.isFinite(rawContextWindow) && rawContextWindow > 0
        ? Math.floor(rawContextWindow)
        : undefined;
    const rawCapabilities = record?.capabilities;
    const capabilities = Array.isArray(rawCapabilities)
      ? [...new Set(rawCapabilities.map(text).filter(Boolean))]
      : undefined;

    seen.add(id);
    result.push({
      id,
      provider,
      providerLabel,
      model,
      label,
      ...(route ? { route } : {}),
      ...(typeof record?.isDefault === "boolean"
        ? { isDefault: record.isDefault }
        : typeof record?.is_default === "boolean"
          ? { isDefault: record.is_default }
          : {}),
      ...(capabilities && capabilities.length > 0 ? { capabilities } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
    });
  }

  return result;
}
