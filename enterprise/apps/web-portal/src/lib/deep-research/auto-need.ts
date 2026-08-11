export type ResearchMessage = { role?: unknown; content?: unknown };

/**
 * This gate deliberately runs before the gateway is called. It is a cheap,
 * deterministic signal extractor, not a second LLM router: an automatic
 * deep-research turn is only selected when the request combines a research
 * action with enough breadth, evidence, comparison, or delivery requirements.
 */

const EXPLICIT_RESEARCH_RE =
  /深度研究|深度调研|深度分析|专题研究|研究报告|系统调研|全面研究|深入研究|deep[-\s]+research|deep[-\s]+analysis|in[-\s]?depth\s+(?:research|analysis)|comprehensive\s+(?:research|analysis)|research\s+report/i;

const CONCEPT_QUESTION_RE =
  /^(?:请问|什么是|何为|如何理解|解释(?:一下)?|介绍(?:一下)?|what\s+is|what\s+does|define|explain)[^。！？?!]{0,80}(?:深度研究|深度调研|深度分析|deep[-\s]+research|deep[-\s]+analysis)/i;

const SOURCE_TRANSFORM_RE =
  /^(?:请|帮我|能否|可以)?\s*(?:总结|摘要|概括|翻译|改写|润色|解释|介绍)[^。！？?!]{0,80}(?:深度研究|深度调研|深度分析|deep[-\s]+research|deep[-\s]+analysis)/i;

const RESEARCH_ACTION_RE =
  /调研|研究|分析|评估|比较|对比|竞品|技术选型|调查|梳理|盘点|考察|审视|评测|基准测试|research|analy[sz]e|compare|evaluate|assess|investigate|survey|benchmark|review|study/i;

const SCOPE_RE =
  /全面|系统|深入|多维|多方面|多个|多种|不同|各类|行业|市场|竞品|方案|现状|趋势|时间线|历史|影响|成本|风险|优缺点|适用场景|落地|实施|可行性|安全性|性能|生态|供应商|地区|国家|cross[-\s]?domain|multi[-\s]?dimensional|multiple|across|landscape|timeline|trend|market|industry|competitor|options?|trade[-\s]?offs?|risks?|costs?|pros\s+and\s+cons|use\s+cases?|feasibility|security|performance|ecosystem|vendors?|regions?|countries?/i;

const BROAD_SCOPE_RE =
  /全面|系统|多维|多方面|多个|多种|不同|各类|行业|市场|竞品|现状|趋势|时间线|历史|跨领域|cross[-\s]?domain|multi[-\s]?dimensional|multiple|across|landscape|timeline|trend|market|industry|competitor/i;

const EVIDENCE_RE =
  /来源|引用|参考|链接|官方|论文|数据|证据|核验|交叉验证|可验证|出处|sources?|citations?|references?|links?|official|papers?|datasets?|evidence|verify|validation|cross[-\s]?check/i;

const DELIVERABLE_RE =
  /报告|白皮书|表格|矩阵|路线图|清单|决策建议|建议|结论|推荐|排序|评分|对比表|方案书|report|brief|matrix|roadmap|decision|recommend(?:ation)?s?|rank(?:ing)?|score|table/i;

const FRESHNESS_RE =
  /最新|截至|当前|近期|最近|过去[一二三四五六七八九十\d]+年|本年|今年|明年|202\d|today|latest|current|recent|as\s+of|since\s+20\d\d/i;

const COMPARISON_RE =
  /比较|对比|竞品|选型|优缺点|取舍|哪个更适合|compare|versus|\bvs\.?\b|trade[-\s]?offs?|pros\s+and\s+cons|which\s+is\s+better/i;

const SIMPLE_TASK_RE =
  /^(?:请|帮我|能否|可以)?\s*(?:翻译|润色|改写|重写|总结|概括|摘要|解释|定义|说明|提取|列出|计算|换算|纠错|校对|格式化|生成标题|改成|翻成|translate|rewrite|summari[sz]e|proofread|format|calculate)/i;

const TRANSFORM_RE =
  /(?:翻译|润色|改写|重写|总结|概括|摘要|解释|定义|说明|提取|列出|计算|换算|纠错|校对|格式化|生成标题|改成|翻成|translate|rewrite|summari[sz]e|proofread|format|calculate)/i;

const NARROW_ANALYSIS_RE =
  /^(?:请|帮我|能否|可以)?\s*(?:分析|评估|解释|看看|判断|analy[sz]e|assess|explain)\s*(?:一下|下|这个|这段|这句|该|the|this|that)*/i;

const FOLLOW_UP_RE =
  /^(?:继续|接着|然后|那(?:么)?|另外|再(?:说说|看看|分析)|展开|详细|具体|上面|刚才|前面|这个|它|这些|其|还有|下一步|就(?:成本|风险|优缺点|适用场景)|what\s+about|how\s+about|continue|expand|go\s+deeper|and\s+the|then)/i;

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => contentToText(part)).filter(Boolean).join(" ");
  }
  if (!content || typeof content !== "object") return "";
  const value = content as Record<string, unknown>;
  if (value.text !== undefined) return contentToText(value.text);
  if (value.content !== undefined) return contentToText(value.content);
  return "";
}

function normalizeQuery(content: unknown): string {
  const text = contentToText(content)
    // The portal appends parsed document bodies after this marker. The user
    // instruction before it is the only part relevant to the routing gate.
    .replace(/(?:^|\n)\s*---\s*(?:附件|attachment)\s*[:：][^\n]*---[\s\S]*$/i, " ")
    .replace(/\[(?:附件|attachment)(?:：|:)[^\]]*\]/gi, " ");
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

type QuerySignals = {
  explicit: boolean;
  hasAction: boolean;
  hasScope: boolean;
  hasBroadScope: boolean;
  hasEvidence: boolean;
  hasDeliverable: boolean;
  hasFreshness: boolean;
  hasComparison: boolean;
  hasSimpleTask: boolean;
  isNarrowAnalysis: boolean;
};

function inspectQuery(query: string): QuerySignals {
  return {
    explicit:
      EXPLICIT_RESEARCH_RE.test(query) &&
      !CONCEPT_QUESTION_RE.test(query) &&
      !SOURCE_TRANSFORM_RE.test(query),
    hasAction: RESEARCH_ACTION_RE.test(query),
    hasScope: SCOPE_RE.test(query),
    hasBroadScope: BROAD_SCOPE_RE.test(query),
    hasEvidence: EVIDENCE_RE.test(query),
    hasDeliverable: DELIVERABLE_RE.test(query),
    hasFreshness: FRESHNESS_RE.test(query),
    hasComparison: COMPARISON_RE.test(query),
    hasSimpleTask: SIMPLE_TASK_RE.test(query),
    isNarrowAnalysis: NARROW_ANALYSIS_RE.test(query),
  };
}

function researchScore(signals: QuerySignals): { score: number; strongSignals: number } {
  const strongSignals = [
    signals.hasScope,
    signals.hasEvidence,
    signals.hasDeliverable,
    signals.hasComparison,
    signals.hasFreshness,
  ].filter(Boolean).length;
  const score =
    2 +
    (signals.hasScope ? 2 : 0) +
    (signals.hasEvidence ? 2 : 0) +
    (signals.hasDeliverable ? 2 : 0) +
    (signals.hasComparison ? 1 : 0) +
    (signals.hasFreshness ? 1 : 0) +
    (signals.hasSimpleTask ? -3 : 0);
  return { score, strongSignals };
}

function isStrongResearchQuery(query: string): boolean {
  const signals = inspectQuery(query);
  if (signals.explicit) return true;
  if (
    !signals.hasAction ||
    (signals.isNarrowAnalysis && !signals.hasScope && !signals.hasEvidence && !signals.hasDeliverable)
  ) {
    return false;
  }

  const { score, strongSignals } = researchScore(signals);
  return (score >= 5 && strongSignals >= 2) || (score >= 4 && signals.hasBroadScope);
}

function shouldInheritResearchContext(query: string, previousQueries: string[]): boolean {
  if (!FOLLOW_UP_RE.test(query) || TRANSFORM_RE.test(query)) return false;
  return previousQueries.some(isStrongResearchQuery);
}

/**
 * Decide whether the current turn deserves the expensive research pipeline.
 * Explicit research wording wins. Otherwise the query must contain a
 * research action plus at least two independent complexity signals. This
 * keeps the persistent chip useful without turning every turn into a costly
 * deep-research run.
 */
export function shouldAutoRunDeepResearch(messages: ResearchMessage[]): boolean {
  const userQueries = messages
    .filter((message) => String(message?.role ?? "").toLowerCase() === "user")
    .map((message) => normalizeQuery(message?.content))
    .filter(Boolean);
  const query = userQueries.at(-1) ?? "";
  if (!query) return false;

  const signals = inspectQuery(query);
  if (signals.explicit) return true;
  if (shouldInheritResearchContext(query, userQueries.slice(0, -1))) return true;
  if (!signals.hasAction) return false;

  // A narrow local transformation/one-off explanation should stay on the
  // normal path even when it happens to contain the word “分析”.
  if (signals.isNarrowAnalysis && !signals.hasScope && !signals.hasEvidence && !signals.hasDeliverable) {
    return false;
  }

  const { score, strongSignals } = researchScore(signals);

  return (score >= 5 && strongSignals >= 2) || (score >= 4 && signals.hasBroadScope);
}
