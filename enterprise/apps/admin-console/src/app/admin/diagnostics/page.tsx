"use client";

import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "@agenticx/ui";
import { useTranslations } from "next-intl";

import { ErrorsPanel } from "../../../components/diagnostics/ErrorsPanel";
import { PerfPanel } from "../../../components/diagnostics/PerfPanel";

/**
 * 网关诊断：错误聚合与性能指标。
 *
 * 两页原本各占一个菜单，加起来不到 160 行，看的还是同一批请求的两个侧面——出错的那些
 * 和慢的那些。排查时本来就要来回对照，拆成两个入口只是让人多点一次。
 */
export default function AdminDiagnosticsPage() {
  const t = useTranslations("pages.admin.diagnostics");

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t("title")} description={t("description")} />
      <Tabs defaultValue="errors">
        <TabsList>
          <TabsTrigger value="errors">{t("tabs.errors")}</TabsTrigger>
          <TabsTrigger value="perf">{t("tabs.perf")}</TabsTrigger>
        </TabsList>
        <TabsContent value="errors" className="pt-4">
          <ErrorsPanel />
        </TabsContent>
        <TabsContent value="perf" className="pt-4">
          <PerfPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
