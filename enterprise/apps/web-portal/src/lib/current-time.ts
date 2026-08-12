/**
 * Authoritative local clock facts for Enterprise chat system prompts.
 *
 * Mirrors agenticx/runtime/prompts/current_time.py so portal BFF can ground
 * date/time answers without web search (Desktop uses the Python helper).
 */

const WEEKDAY_CN = [
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
  "星期日",
] as const;

export type CurrentTimeFacts = {
  localIso: string;
  date: string;
  weekdayCn: string;
  tzName: string;
  utcOffset: string;
  utcIso: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatLocalIso(d: Date): string {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

function formatUtcOffset(d: Date): string {
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${sign}${pad2(Math.floor(abs / 60))}${pad2(abs % 60)}`;
}

export function getCurrentTimeFacts(now: Date = new Date()): CurrentTimeFacts {
  const weekday = WEEKDAY_CN[now.getDay() === 0 ? 6 : now.getDay() - 1] ?? "星期一";
  return {
    localIso: formatLocalIso(now),
    date: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
    weekdayCn: weekday,
    tzName: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    utcOffset: formatUtcOffset(now),
    utcIso: now.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, ""),
  };
}

export function buildCurrentTimeBlock(now: Date = new Date()): string {
  const facts = getCurrentTimeFacts(now);
  return (
    "## 当前时间（权威，来自服务器本机系统时钟）\n" +
    `- 本地时间：${facts.localIso}（${facts.weekdayCn}，` +
    `时区 ${facts.tzName} UTC${facts.utcOffset}）\n` +
    `- 今天日期：${facts.date}\n` +
    "- 回答「今天几号 / 现在几点 / 今年是哪一年 / 距离某日还有多久」等时间问题时，" +
    "**必须**以上述本机时间为唯一权威来源。\n" +
    "- **禁止**用联网搜索查询当前日期、星期或时刻；网页快照日期不可信，" +
    "曾出现搜索结果给出过期或错误日期导致回答偏差的事故。\n" +
    "- 农历、节气、节假日安排等**衍生信息**可以联网查询，但必须先锚定上述公历日期再检索，" +
    "且不得让搜索结果反过来覆盖本机日期。\n"
  );
}

/**
 * True when the user is only asking for the current Gregorian date / weekday / clock time.
 * Lunar / news / weather / schedule questions must still be allowed to search.
 */
export function isCurrentDateTimeQuery(query: string): boolean {
  const raw = query.trim();
  if (!raw) return false;

  const normalized = raw
    .replace(/[啊呢呀嘛么吧哦喔哈？?！!。.～~]+$/gu, "")
    .trim()
    .toLowerCase();

  if (!normalized) return false;

  // Needs external / derived facts — do not short-circuit search.
  if (
    /农历|阴历|节气|节假|假期|放假|新闻|天气|股价|汇率|日程|待办|会议|头条|热点|比赛|比分/.test(
      normalized,
    )
  ) {
    return false;
  }

  if (
    /^(what(?:'s| is|s)?\s+(the\s+)?(current\s+)?(date|day|time)(\s+(is\s+it|today))?|what\s+day\s+is\s+(it|today)|what\s+time\s+is\s+it)$/i.test(
      normalized,
    )
  ) {
    return true;
  }

  return /^(今天|今日|现在)?(是)?(几号|几日|日期|星期几|周几|礼拜几|几点(钟)?|什么时间|哪一年|哪年)(了)?$/.test(
    normalized,
  );
}

type ChatMessage = {
  role: string;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
  name?: string;
};

const CURRENT_TIME_MARKER = "## 当前时间（权威";

/** Prepend / merge the authoritative current-time system block into chat messages. */
export function withCurrentTimeContext<T extends ChatMessage>(
  messages: T[],
  now: Date = new Date(),
): T[] {
  const next = messages.map((m) => ({ ...m }));
  if (
    next[0]?.role === "system" &&
    typeof next[0].content === "string" &&
    next[0].content.includes(CURRENT_TIME_MARKER)
  ) {
    return next;
  }
  const block = buildCurrentTimeBlock(now).trimEnd();
  if (next[0]?.role === "system") {
    const existing = typeof next[0].content === "string" ? next[0].content : "";
    next[0] = {
      ...next[0],
      content: existing ? `${block}\n\n${existing}` : block,
    };
    return next;
  }
  return [{ role: "system", content: block } as T, ...next];
}
