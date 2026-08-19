"use client";

import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "@agenticx/ui";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";

import { CapabilityMarketPanel } from "../../../components/capabilities/CapabilityMarketPanel";
import { CapabilityPacksPanel } from "../../../components/capabilities/CapabilityPacksPanel";
import { DesktopGovernancePanel } from "../../../components/capabilities/DesktopGovernancePanel";
import { McpServersPanel } from "../../../components/capabilities/McpServersPanel";
import { PluginsPanel } from "../../../components/capabilities/PluginsPanel";
import { SkillsPanel } from "../../../components/capabilities/SkillsPanel";
import { WebSearchPanel } from "../../../components/capabilities/WebSearchPanel";

const TABS = ["market", "packs", "mcp", "skills", "search", "plugins", "governance"] as const;
type TabId = (typeof TABS)[number];

function isTabId(value: string | null): value is TabId {
  return value !== null && (TABS as readonly string[]).includes(value);
}

/**
 * 工具与能力：模型之外、要发给员工的一切。
 *
 * MCP 托管、Skill 注册表、能力包、联网搜索、Wasm 插件——原先是五个菜单，管理员想确认
 * 「张三到底能用什么」得挨个点开。它们本来就是一件事：包里发的就是这里注册的东西，
 * 而搜索和插件同样是按同一套分配键发下去的能力。
 *
 * tab 存在 query 里，为的是 /admin/web-search、/admin/plugins 这些旧地址 redirect
 * 过来能直接落到对应的那一页，而不是甩到第一个 tab 让人自己找。
 */
function CapabilitiesTabs() {
  const t = useTranslations("pages.admin.capabilities");
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("tab");
  const active: TabId = isTabId(raw) ? raw : "market";

  const onChange = useCallback(
    (value: string) => {
      // replace 而不是 push：切 tab 不该在浏览器后退栈里堆一层。
      router.replace(value === "market" ? "/admin/capabilities" : `/admin/capabilities?tab=${value}`);
    },
    [router],
  );

  return (
    <Tabs value={active} onValueChange={onChange}>
      <TabsList>
        {TABS.map((id) => (
          <TabsTrigger key={id} value={id}>
            {t(`tabs.${id}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="market" className="pt-4">
        <CapabilityMarketPanel />
      </TabsContent>
      <TabsContent value="mcp" className="pt-4">
        <McpServersPanel />
      </TabsContent>
      <TabsContent value="packs" className="pt-4">
        <CapabilityPacksPanel />
      </TabsContent>
      <TabsContent value="skills" className="pt-4">
        <SkillsPanel />
      </TabsContent>
      <TabsContent value="search" className="pt-4">
        <WebSearchPanel />
      </TabsContent>
      <TabsContent value="plugins" className="pt-4">
        <PluginsPanel />
      </TabsContent>
      <TabsContent value="governance" className="pt-4">
        <DesktopGovernancePanel />
      </TabsContent>
    </Tabs>
  );
}

export default function AdminCapabilitiesPage() {
  const t = useTranslations("pages.admin.capabilities");

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t("title")} description={t("description")} />
      <Suspense fallback={null}>
        <CapabilitiesTabs />
      </Suspense>
    </div>
  );
}
