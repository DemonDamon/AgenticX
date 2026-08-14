import type { DirectPageReference } from "../web-search/direct-page";

export const DIRECT_DOCUMENT_RESEARCH_ANCHOR_POLICY =
  "若输入中已指定具体的文献、上传文件或公开页面（如包含 arXiv 编号或用户指定文档），所有调研车道必须严格围绕该文档本身展开，严禁泛化为‘通用阅读方法/技巧’等方法论调研。";

const GENERIC_DIRECT_DOCUMENT_PROMPTS = [
  /^(?:你)?(?:能|可以|可不可以|能不能|会不会)(?:帮我)?(?:读懂|看懂|阅读|读|看|理解|分析|解读|总结)(?:一下|下)?(?:这|该)?(?:篇|个)?(?:文章|论文|文档|文件|页面|材料|链接)?(?:吗|嘛)?$/u,
  /^(?:请|麻烦)?(?:帮我)?(?:读懂|看懂|阅读|读|看|理解|分析|解读|总结)(?:一下|下)?(?:这|该)?(?:篇|个)?(?:文章|论文|文档|文件|页面|材料|链接)?$/u,
  /^(?:这|该)(?:篇|个)?(?:文章|论文|文档|文件|页面|材料)(?:讲了|说了)?(?:什么|啥)(?:内容)?$/u,
  /^(?:can|could|would)\s+you\s+(?:read|understand|analy[sz]e|summari[sz]e)\s+(?:(?:this|the)\s+)?(?:paper|article|document|file|page)?$/i,
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

function normalizedDocumentTitle(title: string | undefined): string {
  const normalized = String(title ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized.length > 180 ? `${normalized.slice(0, 180)}…` : normalized;
}

export function documentTitleEntity(title: string | undefined): string {
  const normalized = normalizedDocumentTitle(title);
  return normalized ? `《${normalized}》` : "";
}

/** Shared target builder for public pages and user-uploaded documents. */
export function resolveSpecifiedDocumentResearchQuery(
  question: string,
  documentEntity: string,
): string {
  const originalQuestion = question.trim();
  if (isGenericDirectDocumentPrompt(originalQuestion)) {
    return `深度解读${documentEntity}：核心创新、方法论、关键实验与结论`;
  }
  return `围绕${documentEntity}研究：${originalQuestion}`;
}

function directDocumentEntity(
  reference: DirectPageReference,
  documentTitle?: string,
): string {
  const titleEntity = documentTitleEntity(documentTitle);
  if (titleEntity) return titleEntity;
  if (reference.adapterId === "arxiv") {
    const paperId = reference.arxivId?.trim();
    if (paperId) return `论文（arXiv ${paperId}）`;
  }
  try {
    const hostname = new URL(reference.displayUrl).hostname.replace(/^www\./, "");
    if (hostname) return `指定页面（${hostname}）`;
  } catch {
    // Fall through to a neutral entity when the normalized URL is unavailable.
  }
  return "指定页面";
}

/**
 * Turn a capability/deictic prompt into a concrete research target.
 *
 * Without this boundary, a prompt such as “你能读懂这篇文章吗” is a valid
 * direct-page reference but is still handed verbatim to recon and the planner.
 * Search engines and the LLM then generalise it into “how to read a paper”,
 * losing the user-supplied document even though its URL was parsed correctly.
 */
export function resolveDirectDocumentResearchQuery(
  reference: DirectPageReference,
  documentTitle?: string,
): string {
  const documentEntity = directDocumentEntity(reference, documentTitle);
  return resolveSpecifiedDocumentResearchQuery(reference.question, documentEntity);
}
