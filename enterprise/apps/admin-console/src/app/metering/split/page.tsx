"use client";

import { adminFetch } from "../../../lib/admin-client-auth";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@agenticx/ui";
import { Download, FileSpreadsheet, Plus, RefreshCcw, Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

type SplitParticipant = { participant_id: string; label?: string; ratio_bps: number };
type SplitRule = {
  id: string;
  name: string;
  effective_start: string;
  effective_end: string | null;
  split_mode: "fixed_ratio" | "by_billing_item";
  participants: SplitParticipant[];
  enabled: boolean;
};
type ReconcileRow = {
  participant_id: string;
  participant_label: string | null;
  amount_micro_usd: string;
  entry_count: number;
};
type LedgerEntry = {
  id: string;
  usage_record_id: string;
  participant_id: string;
  participant_label: string | null;
  amount_micro_usd: string;
  time_bucket: string;
};
type WebhookEvent = {
  id: string;
  status: string;
  response_status: number | null;
  created_at: string;
};

function microToUsd(micro: string): string {
  const value = Number(micro);
  if (!Number.isFinite(value)) return "0";
  return (value / 1_000_000).toFixed(6);
}

export default function BillingSplitPage() {
  const t = useTranslations("pages.ops.billingSplit");
  const [rules, setRules] = useState<SplitRule[]>([]);
  const [reconcileRows, setReconcileRows] = useState<ReconcileRow[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [syncedCount, setSyncedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [start, setStart] = useState(new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10));
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [ruleName, setRuleName] = useState("");
  const [ruleStart, setRuleStart] = useState(start);
  const [p1Id, setP1Id] = useState("platform");
  const [p1Label, setP1Label] = useState(t("defaults.platform"));
  const [p1Ratio, setP1Ratio] = useState("7000");
  const [p2Id, setP2Id] = useState("data_provider");
  const [p2Label, setP2Label] = useState(t("defaults.dataProvider"));
  const [p2Ratio, setP2Ratio] = useState("3000");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookEvents, setWebhookEvents] = useState<WebhookEvent[]>([]);

  const loadRules = useCallback(async () => {
    const res = await adminFetch("/api/billing/split/rules", { cache: "no-store" });
    const json = (await res.json()) as { data?: { items?: SplitRule[] } };
    setRules(json.data?.items ?? []);
  }, []);

  const loadReconcile = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        start: `${start}T00:00:00.000Z`,
        end: `${end}T23:59:59.999Z`,
      });
      const res = await adminFetch(`/api/billing/split/reconcile?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as {
        data?: { rows?: ReconcileRow[]; ledger_entries?: LedgerEntry[]; synced_usage_count?: number };
      };
      setReconcileRows(json.data?.rows ?? []);
      setLedgerEntries(json.data?.ledger_entries ?? []);
      setSyncedCount(json.data?.synced_usage_count ?? 0);
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  const loadWebhook = useCallback(async () => {
    const [configRes, eventsRes] = await Promise.all([
      adminFetch("/api/billing/settlement/webhook", { cache: "no-store" }),
      adminFetch("/api/billing/settlement/webhook?view=events&limit=20", { cache: "no-store" }),
    ]);
    const configJson = (await configRes.json()) as { data?: { config?: { webhook_url?: string | null; enabled?: boolean } } };
    const eventsJson = (await eventsRes.json()) as { data?: { items?: WebhookEvent[] } };
    setWebhookUrl(configJson.data?.config?.webhook_url ?? "");
    setWebhookEnabled(Boolean(configJson.data?.config?.enabled));
    setWebhookEvents(eventsJson.data?.items ?? []);
  }, []);

  useEffect(() => {
    void loadRules();
    void loadReconcile();
    void loadWebhook();
  }, [loadRules, loadReconcile, loadWebhook]);

  const saveRule = async () => {
    if (!ruleName.trim()) {
      toast.error(t("toast.nameRequired"));
      return;
    }
    const res = await adminFetch("/api/billing/split/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: ruleName.trim(),
        effective_start: `${ruleStart}T00:00:00.000Z`,
        split_mode: "fixed_ratio",
        participants: [
          { participant_id: p1Id.trim(), label: p1Label.trim(), ratio_bps: Number(p1Ratio) },
          { participant_id: p2Id.trim(), label: p2Label.trim(), ratio_bps: Number(p2Ratio) },
        ],
        enabled: true,
      }),
    });
    const json = (await res.json()) as { code?: string; message?: string };
    if (json.code !== "00000") {
      toast.error(json.message ?? t("toast.saveFailed"));
      return;
    }
    toast.success(t("toast.ruleSaved"));
    setRuleName("");
    await loadRules();
  };

  const removeRule = async (id: string) => {
    const res = await adminFetch(`/api/billing/split/rules?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const json = (await res.json()) as { code?: string };
    if (json.code !== "00000") {
      toast.error(t("toast.deleteFailed"));
      return;
    }
    toast.success(t("toast.ruleDeleted"));
    await loadRules();
  };

  const exportCsv = async () => {
    const params = new URLSearchParams({
      start: `${start}T00:00:00.000Z`,
      end: `${end}T23:59:59.999Z`,
      format: "csv",
    });
    const res = await adminFetch(`/api/billing/split/reconcile?${params.toString()}`, { cache: "no-store" });
    const csv = await res.text();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `billing-reconcile-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success(t("toast.exportSuccess"));
  };

  const saveWebhook = async () => {
    const res = await adminFetch("/api/billing/settlement/webhook", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ webhook_url: webhookUrl.trim() || null, enabled: webhookEnabled }),
    });
    const json = (await res.json()) as { code?: string; message?: string };
    if (json.code !== "00000") {
      toast.error(json.message ?? t("toast.saveFailed"));
      return;
    }
    toast.success(t("toast.webhookSaved"));
    await loadWebhook();
  };

  const syncNow = async () => {
    const res = await adminFetch("/api/billing/split/sync", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const json = (await res.json()) as { data?: { synced?: number } };
    toast.success(t("toast.synced", { count: json.data?.synced ?? 0 }));
    await loadReconcile();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/dashboard">Admin</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/metering">{t("breadcrumbMetering")}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{t("breadcrumbSplit")}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void syncNow()}>
              <RefreshCcw className="mr-1.5 h-4 w-4" />
              {t("syncNow")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void exportCsv()}>
              <Download className="mr-1.5 h-4 w-4" />
              {t("exportCsv")}
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="rules" className="space-y-4">
        <TabsList>
          <TabsTrigger value="rules">{t("tabRules")}</TabsTrigger>
          <TabsTrigger value="reconcile">{t("tabReconcile")}</TabsTrigger>
          <TabsTrigger value="webhook">{t("tabWebhook")}</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("newRuleTitle")}</CardTitle>
              <CardDescription>{t("newRuleDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("fields.ruleName")}</Label>
                <Input value={ruleName} onChange={(e) => setRuleName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("fields.effectiveStart")}</Label>
                <Input type="date" value={ruleStart} onChange={(e) => setRuleStart(e.target.value)} />
              </div>
              <div className="space-y-1.5 flex items-end">
                <Button onClick={() => void saveRule()}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  {t("saveRule")}
                </Button>
              </div>
              <div className="space-y-1.5">
                <Label>{t("fields.participant1Id")}</Label>
                <Input value={p1Id} onChange={(e) => setP1Id(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("fields.participant1Label")}</Label>
                <Input value={p1Label} onChange={(e) => setP1Label(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("fields.participant1Ratio")}</Label>
                <Input value={p1Ratio} onChange={(e) => setP1Ratio(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("fields.participant2Id")}</Label>
                <Input value={p2Id} onChange={(e) => setP2Id(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("fields.participant2Label")}</Label>
                <Input value={p2Label} onChange={(e) => setP2Label(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("fields.participant2Ratio")}</Label>
                <Input value={p2Ratio} onChange={(e) => setP2Ratio(e.target.value)} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              {rules.length === 0 ? (
                <EmptyState icon={<FileSpreadsheet className="h-5 w-5" />} title={t("emptyRulesTitle")} description={t("emptyRulesDescription")} className="m-6 border-0" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr className="border-b border-border">
                        <th className="px-4 py-3 text-left">{t("fields.ruleName")}</th>
                        <th className="px-4 py-3 text-left">{t("fields.effectiveStart")}</th>
                        <th className="px-4 py-3 text-left">{t("fields.participants")}</th>
                        <th className="px-4 py-3 text-right">{t("fields.actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rules.map((rule) => (
                        <tr key={rule.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-2.5 font-medium">{rule.name}</td>
                          <td className="px-4 py-2.5 font-mono text-xs">{rule.effective_start.slice(0, 10)}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {rule.participants.map((p) => `${p.label ?? p.participant_id}:${p.ratio_bps / 100}%`).join(" · ")}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <Button variant="ghost" size="icon" onClick={() => void removeRule(rule.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reconcile" className="space-y-4">
          <Card>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>{t("fields.periodStart")}</Label>
                <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("fields.periodEnd")}</Label>
                <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
              <div className="flex items-end">
                <Button variant="outline" onClick={() => void loadReconcile()} disabled={loading}>
                  {loading ? t("loading") : t("refreshReconcile")}
                </Button>
              </div>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">{t("syncHint", { count: syncedCount })}</p>
          {reconcileRows.length === 0 ? (
            <EmptyState icon={<FileSpreadsheet className="h-5 w-5" />} title={t("emptyReconcileTitle")} description={t("emptyReconcileDescription")} className="border border-dashed" />
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("summaryTitle")}</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr className="border-b border-border">
                        <th className="px-4 py-3 text-left">{t("fields.participant")}</th>
                        <th className="px-4 py-3 text-right">{t("fields.amountUsd")}</th>
                        <th className="px-4 py-3 text-right">{t("fields.entryCount")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconcileRows.map((row) => (
                        <tr key={row.participant_id} className="border-b border-border last:border-0">
                          <td className="px-4 py-2.5">{row.participant_label ?? row.participant_id}</td>
                          <td className="px-4 py-2.5 text-right font-mono">${microToUsd(row.amount_micro_usd)}</td>
                          <td className="px-4 py-2.5 text-right font-mono">{row.entry_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("ledgerTitle")}</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr className="border-b border-border">
                        <th className="px-4 py-3 text-left">{t("fields.time")}</th>
                        <th className="px-4 py-3 text-left">{t("fields.participant")}</th>
                        <th className="px-4 py-3 text-left">{t("fields.usageId")}</th>
                        <th className="px-4 py-3 text-right">{t("fields.amountUsd")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerEntries.map((entry) => (
                        <tr key={entry.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-2.5 font-mono text-xs">{entry.time_bucket.slice(0, 19)}</td>
                          <td className="px-4 py-2.5">{entry.participant_label ?? entry.participant_id}</td>
                          <td className="px-4 py-2.5 font-mono text-xs">{entry.usage_record_id.slice(0, 12)}…</td>
                          <td className="px-4 py-2.5 text-right font-mono">${microToUsd(entry.amount_micro_usd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="webhook" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("webhookTitle")}</CardTitle>
              <CardDescription>{t("webhookDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>{t("fields.webhookUrl")}</Label>
                <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://example.com/settlement-hook" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={webhookEnabled} onChange={(e) => setWebhookEnabled(e.target.checked)} />
                {t("fields.webhookEnabled")}
              </label>
              <Button onClick={() => void saveWebhook()}>
                <Save className="mr-1.5 h-4 w-4" />
                {t("saveWebhook")}
              </Button>
            </CardContent>
          </Card>
          {webhookEvents.length === 0 ? (
            <EmptyState icon={<FileSpreadsheet className="h-5 w-5" />} title={t("emptyWebhookTitle")} description={t("emptyWebhookDescription")} className="border border-dashed" />
          ) : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left">{t("fields.time")}</th>
                      <th className="px-4 py-3 text-left">{t("fields.status")}</th>
                      <th className="px-4 py-3 text-right">HTTP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhookEvents.map((event) => (
                      <tr key={event.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2.5 font-mono text-xs">{event.created_at.slice(0, 19)}</td>
                        <td className="px-4 py-2.5">{event.status}</td>
                        <td className="px-4 py-2.5 text-right font-mono">{event.response_status ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
