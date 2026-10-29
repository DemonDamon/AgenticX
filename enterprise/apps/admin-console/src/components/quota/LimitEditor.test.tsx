import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FeatureUsageConfig } from "@agenticx/config";
import {
  actionForScope,
  budgetSaveBody,
  featureSaveBody,
  selectSpendingUnit,
  type BudgetDocument,
  type SpendingDraft,
} from "../../lib/limit-editor-model";
import { LimitEditor } from "./LimitEditor";

const messages = {
  pages: {
    iam: {
      limits: {
        tabs: { spending: "Token / 美元", search: "联网搜索", research: "深度研究" },
        enable: "单独设置上限",
        inherit: "关闭后恢复继承。",
        unitTokens: "Token 上限",
        unitCost: "美元上限",
        exclusive: "Token 与美元只能选一个。",
        period: "统计周期",
        periodDay: "每日",
        periodWeek: "每周",
        periodMonth: "每月",
        amount: "上限",
        warning: "预警阈值",
        action: "达到上限后",
        actionBlock: "停止请求",
        actionWarn: "仅告警，继续放行",
        actionFallback: "切换到备用模型",
        fallbackModel: "备用模型",
        save: "保存上限",
        saving: "保存中…",
        calls: "次调用",
        runs: "次研究",
        sharedCount: "部门成员共同消耗这一次数。",
        personalCount: "只限制这个范围里的每个人。",
        window: { day: "每日", week: "每周", month: "每月" },
        defaults: { title: "全员默认上限", description: "没有更具体规则时使用。" },
        users: { title: "个人上限", description: "只限制这个人。" },
        groups: { title: "本组每人上限", description: "分别限制组里的每个人。" },
        departments: { title: "部门共享上限", description: "部门成员共同消耗。" },
        loadFailed: "读取失败",
        saveFailed: "保存失败",
        conflict: "设置刚被其他管理员修改，请刷新后重试",
        reload: "重新加载",
        missingTarget: "无法识别当前对象",
        needLimit: "请输入大于 0 的上限",
      },
    },
  },
};

function render(element: React.ReactElement) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="zh" timeZone="Asia/Shanghai" messages={messages}>
      {element}
    </NextIntlClientProvider>,
  );
}

const draft: SpendingDraft = {
  enabled: true,
  unit: "tokens",
  period: "month",
  limit: 100,
  warnThresholdPct: 80,
  action: "warn",
};

const budget: BudgetDocument = {
  updatedAt: "2026-10-20T00:00:00.000Z",
  defaults: { unit: "cost_usd", period: "week", limit: 9, action: "warn" },
  departments: { sales: { unit: "tokens", period: "day", limit: 3, action: "warn" } },
  groups: { analysts: { unit: "tokens", period: "month", limit: 4, action: "warn" } },
  users: { ada: { unit: "tokens", period: "month", limit: 2, action: "warn" }, bo: { unit: "tokens", period: "month", limit: 8, action: "block" } },
};

const featureUsage: FeatureUsageConfig = {
  company: { searchCallsPerMonth: 100 },
  users: { ada: { deepResearchRunsPerDay: 2, searchCallsPerDay: 1 } },
  groups: { analysts: { searchCallsPerWeek: 8 } },
};

describe("LimitEditor", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  it("keeps Token and USD mutually exclusive", () => {
    const next = selectSpendingUnit(draft, "cost_usd");
    expect(next.unit).toBe("cost_usd");
    expect(selectSpendingUnit(next, "tokens").unit).toBe("tokens");
    expect(Object.keys(next)).not.toContain("costLimit");
    const html = render(
      <LimitEditor
        scope="users"
        id="ada"
        initial={{ budget, featureUsage }}
      />,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Token 上限");
    expect(html).toContain("美元上限");
  });

  it("fixes the department action at block", () => {
    expect(actionForScope("departments", "warn")).toBe("block");
    expect(actionForScope("departments", "fallback")).toBe("block");
    expect(actionForScope("users", "warn")).toBe("warn");
    const html = render(<LimitEditor scope="departments" id="sales" initial={{ budget }} />);
    expect(html).toContain("停止请求");
    expect(html).not.toContain("仅告警，继续放行");
  });

  it("submits only the edited scope", () => {
    const personal = budgetSaveBody({
      scope: "users",
      id: "ada",
      current: budget,
      draft: { ...draft, limit: 50, action: "fallback", fallbackModel: "economy" },
    });
    expect(Object.keys(personal).sort()).toEqual(["expectedUpdatedAt", "users"]);
    expect(personal.users).toMatchObject({
      ada: { unit: "tokens", limit: 50, action: "fallback", fallbackModel: "economy" },
      bo: { limit: 8 },
    });

    const department = budgetSaveBody({
      scope: "departments",
      id: "sales",
      current: budget,
      draft: { ...draft, action: "warn", limit: 12 },
    });
    expect(Object.keys(department).sort()).toEqual(["departments", "expectedUpdatedAt"]);
    expect(department.departments).toEqual({
      sales: expect.objectContaining({ limit: 12, action: "block" }),
    });

    const counts = featureSaveBody({
      scope: "users",
      id: "ada",
      updatedAt: "2026-10-20T00:00:00.000Z",
      current: featureUsage,
      feature: "search_provider_calls",
      values: { day: 3 },
    });
    expect(Object.keys(counts).sort()).toEqual(["expectedUpdatedAt", "featureUsage"]);
    expect(counts.featureUsage.company).toEqual({ searchCallsPerMonth: 100 });
    expect(counts.featureUsage.users?.ada).toMatchObject({
      searchCallsPerDay: 3,
      deepResearchRunsPerDay: 2,
    });
    expect(counts.featureUsage.groups?.analysts).toEqual({ searchCallsPerWeek: 8 });
  });
});
