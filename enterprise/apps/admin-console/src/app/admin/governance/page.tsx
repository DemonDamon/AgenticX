"use client";

import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "@agenticx/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";

import { AgentTracesPanel } from "../../../components/governance/AgentTracesPanel";
import { AuditPanel } from "../../../components/governance/AuditPanel";
import { CompliancePanel } from "../../../components/governance/CompliancePanel";
import { PolicyPanel } from "../../../components/governance/PolicyPanel";
import { PortalLogsPanel } from "../../../components/governance/PortalLogsPanel";

const TABS = [
  { id: "audit", label: "操作审计" },
  { id: "logs", label: "请求日志" },
  { id: "traces", label: "词元追踪" },
  { id: "policy", label: "内容策略" },
  { id: "compliance", label: "合规留存" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTabId(value: string | null): value is TabId {
  return value !== null && TABS.some((tab) => tab.id === value);
}

/**
 * 安全与审计：发生过什么、按什么规则拦、留多久。
 *
 * 原本是五个一级菜单——操作审计、Portal 日志、词元追踪、内容策略、合规留存。查一件事
 * 通常要串着看：审计里看到一次调用，要去日志里看请求，再去追踪里看这轮花了多少 token。
 * 拆成五个入口的结果是管理员自己在标签页之间来回跳，还得记住哪个页面查得到什么。
 */
function GovernanceTabs() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("tab");
  const active: TabId = isTabId(raw) ? raw : "audit";

  const onChange = useCallback(
    (value: string) => {
      router.replace(value === "audit" ? "/admin/governance" : `/admin/governance?tab=${value}`);
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
      <TabsContent value="audit" className="pt-4">
        <AuditPanel />
      </TabsContent>
      <TabsContent value="logs" className="pt-4">
        <PortalLogsPanel />
      </TabsContent>
      <TabsContent value="traces" className="pt-4">
        <AgentTracesPanel />
      </TabsContent>
      <TabsContent value="policy" className="pt-4">
        <PolicyPanel />
      </TabsContent>
      <TabsContent value="compliance" className="pt-4">
        <CompliancePanel />
      </TabsContent>
    </Tabs>
  );
}

export default function AdminGovernancePage() {
  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="安全与审计"
        description="发生过什么、按什么规则拦、留多久。查一件事通常要串着看，所以放在同一页。"
      />
      <Suspense fallback={null}>
        <GovernanceTabs />
      </Suspense>
    </div>
  );
}
