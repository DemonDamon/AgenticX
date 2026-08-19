"use client";

import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "@agenticx/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";

import { BillingSplitPanel } from "../../components/metering/BillingSplitPanel";
import { BudgetPanel } from "../../components/metering/BudgetPanel";
import { UsagePanel } from "../../components/metering/UsagePanel";

const TABS = [
  { id: "usage", label: "用量" },
  { id: "split", label: "分账" },
  { id: "budget", label: "预算" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTabId(value: string | null): value is TabId {
  return value !== null && TABS.some((tab) => tab.id === value);
}

/**
 * 用量与成本：花了多少、怎么分摊、上限是多少。
 *
 * 预算原本单独占一个菜单（/metering/quota）。预算和实际用量分两个页面看，等于每次都要
 * 记住另一页的数字再回来比——它们本来就是同一个问题的两面。
 */
function MeteringTabs() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("tab");
  const active: TabId = isTabId(raw) ? raw : "usage";

  const onChange = useCallback(
    (value: string) => {
      router.replace(value === "usage" ? "/metering" : `/metering?tab=${value}`);
    },
    [router],
  );

  return (
    <Tabs value={active} onValueChange={onChange}>
      <TabsList>
        {TABS.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="usage" className="pt-4">
        <UsagePanel />
      </TabsContent>
      <TabsContent value="split" className="pt-4">
        <BillingSplitPanel />
      </TabsContent>
      <TabsContent value="budget" className="pt-4">
        <BudgetPanel />
      </TabsContent>
    </Tabs>
  );
}

export default function MeteringPage() {
  return (
    <div className="space-y-6 p-6">
      <PageHeader title="用量与成本" description="只读的用量与分账，加上「钱」这一侧的预算。token 额度跟着人走，在「组织与成员」里配。" />
      <Suspense fallback={null}>
        <MeteringTabs />
      </Suspense>
    </div>
  );
}
