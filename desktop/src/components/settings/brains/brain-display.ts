import { i18n } from "../../../i18n/i18n";

const STOCK_DEFAULT_DOCS_NAMES = new Set(["默认文档库", "Default document library"]);

export function displayBrainName(brain: { id: string; name?: string | null }): string {
  const name = String(brain.name ?? "").trim();
  if (brain.id === "default_docs" && (!name || STOCK_DEFAULT_DOCS_NAMES.has(name))) {
    return String(i18n.t("brains.defaultDocsName", { ns: "settings" }));
  }
  return name;
}
