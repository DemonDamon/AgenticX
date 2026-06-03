/** Scan row passed from guard-scan-all for Meta-Agent remediation. */
export type GuardFixScanItem = {
  skill_name: string;
  verdict: string;
  base_dir?: string;
  score?: number;
  grade?: string;
  tier?: string;
  findings?: Array<{
    pattern_name: string;
    severity?: string;
    matched_text?: string;
    file_path?: string;
    line_number?: number;
  }>;
};

function formatFindingLines(
  findings: GuardFixScanItem["findings"],
  max = 12,
): string {
  if (!findings?.length) return "（无明细，请自行扫描该目录）";
  const lines = findings.slice(0, max).map((f) => {
    const sev = f.severity === "dangerous" ? "高危" : "注意";
    const loc = f.file_path
      ? ` @ ${f.file_path}${f.line_number ? `:${f.line_number}` : ""}`
      : "";
    const snippet = f.matched_text ? ` 「${f.matched_text.slice(0, 80)}」` : "";
    return `- [${sev}] ${f.pattern_name}${loc}${snippet}`;
  });
  if (findings.length > max) {
    lines.push(`- … 另有 ${findings.length - max} 条`);
  }
  return lines.join("\n");
}

/**
 * Prompt for Meta-Agent: remediate guard findings under a single skill directory.
 * File writes go through the normal tool confirmation flow (unified diff before apply).
 */
export function buildGuardFixPrompt(item: GuardFixScanItem): string {
  const name = item.skill_name.trim();
  const base = (item.base_dir ?? "").trim();
  if (!name || !base) return "";

  const verdictLabel =
    item.verdict === "dangerous" ? "高危" : item.verdict === "caution" ? "需注意" : item.verdict;

  return [
    `请修复本地技能「${name}」的安全扫描问题。技能目录（勿改其它路径）：`,
    base,
    "",
    "扫描摘要：",
    `- 总体：${verdictLabel}`,
    item.grade ? `- 等级：${item.grade}` : "",
    typeof item.score === "number" ? `- 评分：${item.score}` : "",
    item.tier ? `- 体量：${item.tier}` : "",
    "",
    "命中规则（优先处理「高危」）：",
    formatFindingLines(item.findings),
    "",
    "要求：",
    "1. 仅修改上述目录内文件；优先 `skill_manage` action=patch，小范围可用 `file_edit`。",
    "2. 文档/示例里的 127.0.0.1、os.environ 等若是教程占位，改为 `<HOST>` / `<ENV_VAR>` 等占位符，勿破坏技能用途。",
    "3. 对真实风险（外泄 curl、exec/eval、破坏性 shell、凭据路径等）应删除、替换为安全写法或移到「需用户自行配置」说明。",
    "4. 每次写入会弹出 diff 供我确认，请分步修改（不要一次改太多文件），改完简要列出变更点。",
    "5. 若某条规则属于误报且无法安全改写，在回复中说明原因，不要强行改坏文档。",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
