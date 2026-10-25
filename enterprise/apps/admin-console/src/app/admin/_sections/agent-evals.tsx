"use client";

import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "@agenticx/ui";
import { useTranslations } from "next-intl";

import { CandidatesTab } from "../../../components/agent-evals/CandidatesTab";
import { DatasetsTab } from "../../../components/agent-evals/DatasetsTab";
import { RubricsTab } from "../../../components/agent-evals/RubricsTab";
import { RunsTab } from "../../../components/agent-evals/RunsTab";

export default function AgentEvalsSection() {
  const t = useTranslations("pages.admin.agentEvals");
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <Tabs defaultValue="datasets">
        <TabsList>
          <TabsTrigger value="datasets">{t("tabs.datasets")}</TabsTrigger>
          <TabsTrigger value="rubrics">{t("tabs.rubrics")}</TabsTrigger>
          <TabsTrigger value="runs">{t("tabs.runs")}</TabsTrigger>
          <TabsTrigger value="candidates">{t("tabs.candidates")}</TabsTrigger>
        </TabsList>
        <TabsContent value="datasets"><DatasetsTab /></TabsContent>
        <TabsContent value="rubrics"><RubricsTab /></TabsContent>
        <TabsContent value="runs"><RunsTab /></TabsContent>
        <TabsContent value="candidates"><CandidatesTab /></TabsContent>
      </Tabs>
    </div>
  );
}
