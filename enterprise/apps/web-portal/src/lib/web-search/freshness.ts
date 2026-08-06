export type BochaFreshness = "oneDay" | "oneWeek" | "oneMonth" | "oneYear" | "noLimit";

/** 强时效：当日数据才有意义。 */
const ONE_DAY =
  /天气|气温|温度|湿度|风力|降雨|降水|台风|空气质量|实时|今天|今日|现在|此刻|股价|汇率|金价|油价|比分|赛况|开盘|收盘/;

/** 中时效：一周内。 */
const ONE_WEEK = /新闻|头条|最新|近期|发布|上线|财报|季报|公告|版本|更新日志|release/i;

/**
 * 无匹配返回 undefined = 不加 freshness 约束（等价 noLimit），
 * 避免对「XX 是谁」这类稳定事实误加时间窗导致召回变差。
 */
export function resolveFreshness(query: string): BochaFreshness | undefined {
  const q = query.trim();
  if (!q) return undefined;
  if (ONE_DAY.test(q)) return "oneDay";
  if (ONE_WEEK.test(q)) return "oneWeek";
  return undefined;
}
