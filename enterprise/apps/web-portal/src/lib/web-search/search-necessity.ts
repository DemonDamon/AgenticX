/**
 * Lightweight auto-search gate.
 *
 * Auto mode should spend the external-search round trip only when the user
 * explicitly asks for lookup or the wording clearly depends on current /
 * public-web facts. Ordinary writing, explanation, translation and analysis
 * turns stay on the model's direct path.
 */
import { isCurrentDateTimeQuery } from "../current-time";

export type WebSearchSkipReason =
  | "datetime" // 纯日期/时刻 → 以本机时钟为权威
  | "greeting" // 寒暄、道谢、告别、确认
  | "assistant_meta" // 问助手身份/能力
  | "attachment_only" // 只让处理已注入的附件内容
  | "arithmetic" // 纯算式
  | "self_contained" // 自包含的写作、解释、翻译或分析问题
  | "referential_no_entity"; // 指代追问但历史消解不出实体（由 tool-loop 构造）

export type WebSearchNeed =
  | { need: "search" }
  | { need: "skip"; reason: WebSearchSkipReason };

export type ClassifyInput = {
  /** sanitizeWebSearchQuery 之后的短查询（可能为空）。 */
  query: string;
  /** 最后一条 user 消息的原始文本（未剥附件），用于识别附件轮次。 */
  rawQuery?: string;
};

const SEARCH_INTENT =
  /搜一下|搜索|检索|查一下|查一查|查询|查找|帮我找|找一下|找出|搜集|调查一下|调研|research|search|look\s*up|look\s*for|find|browse/i;

// `(?<!你)是谁`：命中「X 是谁」类信息问句，但不否决助手元问题「你是谁」。
const EXTERNAL_INFO_MARKERS =
  /最新|近期|最近|目前|当前|实时|现在的|今日|今天的|明天|本周|本月|今年|去年|昨天|新闻|头条|热点|事件|价格|股价|汇率|多少钱|财报|发布|版本|上线|排行|榜单|评测|对比|教程|文档|官网|地址|电话|天气|赛程|比分|招聘|政策|法规|公告|作者|论文|(?<!你)是谁|哪家|哪个公司|latest|recent|current|now|real[- ]?time|today|tomorrow|news|price|release|version|weather|stock/i;

const GREETING =
  /^(你好+|您好|哈喽|哈啰|嗨|hi+|hello+|hey|早|早上好|上午好|中午好|下午好|晚上好|晚安|在吗|在么|有人吗|你在吗|test|测试|谢谢|谢谢你|多谢|感谢|thanks?|thank you|thx|好的?|行|收到|明白|知道了|懂了|ok|okay|嗯+|哦+|再见|拜拜|bye|goodbye|辛苦了|加油|哈哈+|666)$/i;

const ASSISTANT_META =
  /^(你是谁|你是什么|你叫什么(名字)?|你的名字(是什么)?|你能(做什么|干什么|帮我做什么)|你会(什么|做什么)|你有什么(功能|能力)|你是(什么|哪个)模型|介绍一下你自己|自我介绍|who are you|what can you do|what are you|your name)$/i;

const WEB_CAPABILITY =
  /^(?:(?:现在|当前|本平台|系统|你)\s*)?(?:有|支持|提供|能|可以|是否)?\s*(?:联网|上网|网络|网页|web)\s*(?:搜索|检索|查询|查资料|访问互联网)?\s*(?:功能)?\s*(?:吗|么|呢)?$/i;

const ARITHMETIC = /^[\d\s+\-*/×÷().=%]+$/;
const ARITHMETIC_OP = /[+\-*/×÷=%]/;

const ATTACHMENT_MARKER = /(^|\n)---\s*附件\s*[:：]/;
const ATTACHMENT_USER_TEXT_MAX = 40;

function normalize(query: string): string {
  // Do not strip 么/嘛 — they are part of 什么 / 做什么 / 怎么, etc.
  return query
    .trim()
    .replace(/[啊呀呢吧哦喔哈~～!！?？。.,，、]+$/gu, "")
    .trim()
    .toLowerCase();
}

/** User prose before / without the portal-injected attachment body block. */
function userTextWithoutAttachment(rawQuery: string): string {
  const text = rawQuery.replace(/\r\n/g, "\n");
  const idx = text.search(/\n---\s*附件\s*[:：]/);
  if (idx >= 0) return text.slice(0, idx).trim();
  if (/^---\s*附件\s*[:：]/.test(text.trimStart())) return "";
  return text.trim();
}

export function classifyWebSearchNeed(input: ClassifyInput): WebSearchNeed {
  const query = (input.query ?? "").trim();
  const rawQuery = input.rawQuery ?? "";

  const normalized = normalize(query);

  // Capability questions must be answered from the current product state,
  // not sent to a web search that may make the model describe the wrong UI.
  if (normalized && (ASSISTANT_META.test(normalized) || WEB_CAPABILITY.test(normalized))) {
    return { need: "skip", reason: "assistant_meta" };
  }

  // Pure current date/time — ground on local clock instead of searching.
  if (query && isCurrentDateTimeQuery(query)) {
    return { need: "skip", reason: "datetime" };
  }

  // Explicit lookup intent and clearly time-sensitive / public-web facts win.
  if (query && (SEARCH_INTENT.test(query) || EXTERNAL_INFO_MARKERS.test(query))) {
    return { need: "search" };
  }

  // Attachment-only: short self-contained instruction over injected file body.
  if (ATTACHMENT_MARKER.test(rawQuery)) {
    const userText = userTextWithoutAttachment(rawQuery);
    if (
      userText.length <= ATTACHMENT_USER_TEXT_MAX &&
      !SEARCH_INTENT.test(userText) &&
      !EXTERNAL_INFO_MARKERS.test(userText)
    ) {
      return { need: "skip", reason: "attachment_only" };
    }
  }

  // Empty query has no useful search terms; let the direct path handle it.
  if (!query) {
    return { need: "skip", reason: "self_contained" };
  }

  // Greeting / thanks / ack.
  if (GREETING.test(normalized)) {
    return { need: "skip", reason: "greeting" };
  }

  // Pure arithmetic.
  if (ARITHMETIC.test(normalized) && ARITHMETIC_OP.test(normalized)) {
    return { need: "skip", reason: "arithmetic" };
  }

  // Anything without a strong external-fact signal stays on the direct path.
  return { need: "skip", reason: "self_contained" };
}

export function shouldSkipWebSearch(input: ClassifyInput): boolean {
  return classifyWebSearchNeed(input).need === "skip";
}
