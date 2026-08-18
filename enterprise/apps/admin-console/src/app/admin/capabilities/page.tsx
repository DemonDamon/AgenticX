"use client";

import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "@agenticx/ui";
import { useTranslations } from "next-intl";

import { CapabilityPacksPanel } from "../../../components/capabilities/CapabilityPacksPanel";
import { McpServersPanel } from "../../../components/capabilities/McpServersPanel";
import { SkillsPanel } from "../../../components/capabilities/SkillsPanel";

/**
 * 工具与能力：MCP 托管、能力包、Skill 注册表。
 *
 * 三者本来就是一件事的三个面——包的成员就是这里注册的 MCP 与 Skill——拆成三个菜单
 * 的结果是管理员要在页面之间来回跳才能确认一个包到底发了什么。
 */
export default function AdminCapabilitiesPage() {
  const t = useTranslations("pages.admin.capabilities");

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t("title")} description={t("description")} />
      <Tabs defaultValue="mcp">
        <TabsList>
          <TabsTrigger value="mcp">{t("tabs.mcp")}</TabsTrigger>
          <TabsTrigger value="packs">{t("tabs.packs")}</TabsTrigger>
          <TabsTrigger value="skills">{t("tabs.skills")}</TabsTrigger>
        </TabsList>
        <TabsContent value="mcp" className="pt-4">
          <McpServersPanel />
        </TabsContent>
        <TabsContent value="packs" className="pt-4">
          <CapabilityPacksPanel />
        </TabsContent>
        <TabsContent value="skills" className="pt-4">
          <SkillsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
