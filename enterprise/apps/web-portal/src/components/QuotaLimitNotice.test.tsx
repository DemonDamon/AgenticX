import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useLocale: () => "zh-CN",
  useTranslations: () =>
    (key: string, values?: Record<string, string>) => {
      const messages: Record<string, string> = {
        quotaExhaustedTitle: "Token 配额已用尽",
        quotaExhaustedDescription: "配额已用尽",
        quotaExhaustedPageNotice: "配额已用尽",
        quotaDayExhaustedTitle: "今日 Token 额度已用尽",
        quotaWeekExhaustedTitle: "本周 Token 额度已用尽",
        quotaMonthExhaustedTitle: "本月 Token 额度已用尽",
        quotaWindowExhaustedDescription: "已开始的任务可以继续完成；新的任务请在额度重置后再试。",
        quotaPeriodDetail: `额度周期：${values?.period}。`,
        quotaUsageDetail: `已使用 ${values?.used} / ${values?.limit} Token。`,
        quotaResetAt: `额度将在 ${values?.time} 重置。`,
        quotaExhaustedAcknowledge: "知道了",
      };
      return messages[key] ?? key;
    },
}));

import { QuotaLimitNotice } from "./QuotaLimitNotice";

describe("QuotaLimitNotice", () => {
  it("renders the exact weekly quota scope instead of generic monthly copy", () => {
    const html = renderToStaticMarkup(
      <QuotaLimitNotice
        quotaError={{
          kind: "token_week",
          message: "本周 Token 额度已用尽；新任务请在重置后再试。",
          period: "2026-W34",
          resetAt: "2026-08-24T00:00:00Z",
          used: 1_100,
          limit: 1_000,
        }}
      />,
    );

    expect(html).toContain("本周 Token 额度已用尽");
    expect(html).toContain("已开始的任务可以继续完成");
    expect(html).toContain("2026-W34");
    expect(html).toContain("1,100");
    expect(html).toContain("1,000");
    expect(html).not.toContain("本月 Token 额度已用尽");
  });
});
