/**
 * Heuristics for open-ended research queries.
 *
 * LLM clarifier/planner may skip or collapse after recon grounding; these helpers
 * provide a deterministic floor so "核心技术点" style asks still clarify and fan out.
 */

export function looksOpenEndedResearchQuery(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  // Tight factual asks should not force clarify / multi-lane expansion.
  if (
    /^(谁|何时|什么时候|是否|有没有|多少|哪一天|官网)/.test(q) ||
    /发布时间|发布日期|是谁|多少钱|股价|天气/.test(q)
  ) {
    return false;
  }
  if (
    /核心技术|技术点|全面|综述|对比|调研|盘点|演进|深度分析|怎么看|如何评价|优缺点|差异|架构|训练|推理/.test(
      q,
    )
  ) {
    return true;
  }
  // Short bare topic without a concrete single-focus ask → open research.
  // Ignore ultra-short stubs used in unit tests ("q") and force real topics.
  return q.length >= 4 && q.length <= 48 && !/[?？]/.test(q);
}

export function defaultFocusOptions(query: string): Array<{ id: string; label: string }> {
  const q = query.trim();
  if (/模型|llm|deepseek|gpt|claude|架构|训练|推理|大模型/i.test(q)) {
    return [
      { id: "arch", label: "模型架构创新（如 MoE、注意力机制等）" },
      { id: "train", label: "训练数据与训练/优化方式" },
      { id: "infer", label: "推理部署与成本优化" },
      { id: "eval", label: "能力评测与典型应用" },
    ];
  }
  return [
    { id: "overview", label: "基本定义与最新进展" },
    { id: "mechanism", label: "关键机制与细节" },
    { id: "practice", label: "实践应用与落地" },
    // 保留稳定 option id，避免已持久化澄清答案失配；只收敛默认展示语义。
    { id: "gaps", label: "关键表现、直接证据与适用条件" },
  ];
}

export function defaultFacetLanes(topic: string): string[] {
  const base = topic.trim() || "研究主题";
  return defaultFocusOptions(base).map((opt) => `${base}：${opt.label}`);
}

export function truncateTopic(query: string, maxChars = 28): string {
  const q = query.trim();
  if (q.length <= maxChars) return q;
  return `${q.slice(0, maxChars)}…`;
}
