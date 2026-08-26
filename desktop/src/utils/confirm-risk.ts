export type ConfirmRisk = "low" | "medium" | "high" | "unknown";

/** 缺失或无法识别的 risk 一律当受保护——与后端 fail-closed 对齐。 */
export function normalizeRisk(raw: unknown): ConfirmRisk {
  const text = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (text === "low" || text === "medium" || text === "high") return text;
  return "unknown";
}

/** 受保护 = 不允许被 auto 模式放行。 */
export function isProtectedRisk(risk: ConfirmRisk): boolean {
  return risk !== "low";
}

/** 展示用：中文标签 + 主题 token 类名（不要硬编码颜色）。 */
export function riskPresentation(risk: ConfirmRisk): { label: string; className: string } {
  if (risk === "low") {
    return { label: "低风险", className: "text-text-muted" };
  }
  if (risk === "medium") {
    return { label: "中风险", className: "text-amber-500" };
  }
  if (risk === "high") {
    return { label: "高风险", className: "text-amber-500" };
  }
  return { label: "未判定", className: "text-text-muted" };
}
