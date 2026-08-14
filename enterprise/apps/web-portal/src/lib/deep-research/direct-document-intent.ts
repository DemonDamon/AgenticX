import type { DirectPageReference } from "../web-search/direct-page";

export const DIRECT_DOCUMENT_RESEARCH_ANCHOR_POLICY =
  "若输入中已指定具体的文献或公开页面（如包含 arXiv 编号或用户指定文档），所有调研车道必须严格围绕该文档本身展开，严禁泛化为‘通用阅读方法/技巧’等方法论调研。";

const GENERIC_DIRECT_DOCUMENT_PROMPTS = [
  /^(?:你)?(?:能|可以|可不可以|能不能|会不会)(?:帮我)?(?:读懂|看懂|阅读|读|看|理解|分析|解读|总结)(?:一下|下)?(?:这|该)?(?:篇|个)?(?:文章|论文|文档|页面|材料|链接)?(?:吗|嘛)?$/u,
  /^(?:请|麻烦)?(?:帮我)?(?:读懂|看懂|阅读|读|看|理解|分析|解读|总结)(?:一下|下)?(?:这|该)?(?:篇|个)?(?:文章|论文|文档|页面|材料|链接)?$/u,
  /^(?:这|该)(?:篇|个)?(?:文章|论文|文档|页面|材料)(?:讲了|说了)?(?:什么|啥)(?:内容)?$/u,
  /^(?:can|could|would)\s+you\s+(?:read|understand|analy[sz]e|summari[sz]e)\s+(?:(?:this|the)\s+)?(?:paper|article|document|page)?$/i,
];

function normalizedPrompt(text: string): string {
  return text
    .trim()
    .replace(/[\s\p{P}\p{S}]+$/gu, "")
    .replace(/\s+/g, " ");
}

export function isGenericDirectDocumentPrompt(question: string): boolean {
  const normalized = normalizedPrompt(question);
  if (!normalized) return true;
  return GENERIC_DIRECT_DOCUMENT_PROMPTS.some((pattern) => pattern.test(normalized));
}

function directDocumentLabel(reference: DirectPageReference): string {
  if (reference.adapterId === "arxiv") {
    const paperId = reference.arxivId?.trim();
    return paperId ? `用户指定的论文（arXiv ${paperId}）` : "用户指定的论文";
  }
  return `用户指定的公开页面（${reference.displayUrl}）`;
}

/**
 * Turn a capability/deictic prompt into a concrete research target.
 *
 * Without this boundary, a prompt such as “你能读懂这篇文章吗” is a valid
 * direct-page reference but is still handed verbatim to recon and the planner.
 * Search engines and the LLM then generalise it into “how to read a paper”,
 * losing the user-supplied document even though its URL was parsed correctly.
 */
export function resolveDirectDocumentResearchQuery(reference: DirectPageReference): string {
  const question = reference.question.trim();
  const documentLabel = directDocumentLabel(reference);
  if (!isGenericDirectDocumentPrompt(question)) {
    // Keep the user's scoped follow-up verbatim, but restore the document identity
    // that was carried by an earlier turn (or removed while parsing the current URL).
    return `围绕${documentLabel}回答：${question}`;
  }

  if (reference.adapterId === "arxiv") {
    return `解读${documentLabel}：研究问题、核心方法、关键实验结果、主要结论与局限`;
  }
  return `解读${documentLabel}：核心主题、关键论据、主要结论与局限`;
}
