"use client";

import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "@agenticx/ui";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";

import { CapabilityPacksPanel } from "../../../components/capabilities/CapabilityPacksPanel";
import { McpServersPanel } from "../../../components/capabilities/McpServersPanel";
import { SkillsPanel } from "../../../components/capabilities/SkillsPanel";

const TABS = ["packs", "skills", "mcp"] as const;
type TabId = (typeof TABS)[number];

function isTabId(value: string | null): value is TabId {
  return value !== null && (TABS as readonly string[]).includes(value);
}

function CapabilitiesTabs() {
  const t = useTranslations("pages.admin.capabilities");
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("tab");
  const active: TabId = isTabId(raw) ? raw : "packs";

  const onChange = useCallback(
    (value: string) => {
      router.replace(value === "packs" ? "/admin/capabilities" : `/admin/capabilities?tab=${value}`);
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
      <TabsContent value="packs" className="pt-4">
        <CapabilityPacksPanel />
      </TabsContent>
      <TabsContent value="skills" className="pt-4">
        <SkillsPanel />
      </TabsContent>
      <TabsContent value="mcp" className="pt-4">
        <McpServersPanel />
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
