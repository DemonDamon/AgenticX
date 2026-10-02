import { isProtectedRisk, normalizeRisk } from "./confirm-risk";

/** 仅低风险工具确认卡提供「本会话不再询问」；缺省/未知风险按受保护处理。 */
export function shouldOfferSessionRemember(context?: Record<string, unknown> | null): boolean {
  if (!context) return false;
  const tool = typeof context.tool === "string" ? context.tool.trim() : "";
  if (!tool) return false;
  return !isProtectedRisk(normalizeRisk(context.risk));
}
