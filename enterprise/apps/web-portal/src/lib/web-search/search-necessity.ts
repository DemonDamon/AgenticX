/**
 * Allowlist-style gate: only obviously self-contained turns skip search-first.
 * Anything unrecognized MUST fall through to "search" so info queries never regress.
 */
import { isCurrentDateTimeQuery } from "../current-time";
import { isPortalCapabilityQuestion } from "../portal-capabilities";

export type WebSearchSkipReason =
  | "datetime" // 纯日期/时刻 → 以本机时钟为权威
  | "greeting" // 寒暄、道谢、告别、确认
  | "assistant_meta" // 问助手身份/能力
  | "attachment_only" // 只让处理已注入的附件内容
  | "arithmetic" // 纯算式
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

// `(?<!你)是谁`：命中「X 是谁」类信息问句，但不否决助手元问题「你是谁」。
const INFO_MARKERS =
  /最新|近期|今年|去年|昨天|今天的|新闻|头条|热点|价格|股价|汇率|多少钱|财报|发布|版本|上线|排行|榜单|评测|对比|教程|文档|官网|地址|电话|天气|赛程|比分|招聘|政策|法规|公告|(?<!你)是谁|哪家|哪个公司|latest|news|price|release|version|weather|stock/i;

const GREETING =
  /^(你好+|您好|哈喽|哈啰|嗨|hi+|hello+|hey|早|早上好|上午好|中午好|下午好|晚上好|晚安|在吗|在么|有人吗|你在吗|test|测试|谢谢|谢谢你|多谢|感谢|thanks?|thank you|thx|好的?|行|收到|明白|知道了|懂了|ok|okay|嗯+|哦+|再见|拜拜|bye|goodbye|辛苦了|加油|哈哈+|666)$/i;

const ASSISTANT_META =
  /^(你是谁|你是什么|你叫什么(名字)?|你的名字(是什么)?|你能(做什么|干什么|帮我做什么)|你会(什么|做什么)|你有什么(功能|能力)|你是(什么|哪个)模型|介绍一下你自己|自我介绍|who are you|what can you do|what are you|your name)$/i;

const ARITHMETIC = /^[\d\s+\-*/×÷().=%]+$/;
const ARITHMETIC_OP = /[+\-*/×÷=%]/;

const ATTACHMENT_MARKER = /(^|\n)---\s*(?:附件|attachment)\s*[:：]/i;
const SHORT_QUERY_MAX = 24;
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
  const idx = text.search(/\n---\s*(?:附件|attachment)\s*[:：]/i);
  if (idx >= 0) return text.slice(0, idx).trim();
  if (/^---\s*(?:附件|attachment)\s*[:：]/i.test(text.trimStart())) return "";
  return text.trim();
}

export function classifyWebSearchNeed(input: ClassifyInput): WebSearchNeed {
  const query = (input.query ?? "").trim();
  const rawQuery = input.rawQuery ?? "";

  // 1) Informational markers on the sanitized query win first.
  if (query && INFO_MARKERS.test(query)) {
    return { need: "search" };
  }

  // 2) Pure current date/time — ground on local clock.
  if (query && isCurrentDateTimeQuery(query)) {
    return { need: "skip", reason: "datetime" };
  }

  // 3) Attachment-only: short self-contained instruction over injected file body.
  if (ATTACHMENT_MARKER.test(rawQuery)) {
    const userText = userTextWithoutAttachment(rawQuery);
    if (
      userText.length <= ATTACHMENT_USER_TEXT_MAX &&
      !INFO_MARKERS.test(userText)
    ) {
      return { need: "skip", reason: "attachment_only" };
    }
  }

  // Empty query (and not attachment_only) → keep search / degrade path.
  if (!query) {
    return { need: "search" };
  }

  // Length guard for exact-match skip rules.
  if (query.length > SHORT_QUERY_MAX) {
    return { need: "search" };
  }

  const normalized = normalize(query);
  if (!normalized) {
    return { need: "search" };
  }

  // 4) Greeting / thanks / ack
  if (GREETING.test(normalized)) {
    return { need: "skip", reason: "greeting" };
  }

  // 5) Assistant identity / capability
  if (ASSISTANT_META.test(normalized) || isPortalCapabilityQuestion(normalized)) {
    return { need: "skip", reason: "assistant_meta" };
  }

  // 6) Pure arithmetic
  if (ARITHMETIC.test(normalized) && ARITHMETIC_OP.test(normalized)) {
    return { need: "skip", reason: "arithmetic" };
  }

  // 7) Default: search
  return { need: "search" };
}

export function shouldSkipWebSearch(input: ClassifyInput): boolean {
  return classifyWebSearchNeed(input).need === "skip";
}
