"use client";
import { adminFetch } from "../../lib/admin-client-auth";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Badge,
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
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";
import { Pencil, Plus, RotateCcw, Send, ShieldCheck, ShieldX, TestTube2, Trash2 } from "lucide-react";

type PolicyAppliesTo = {
  departmentIds: string[];
  roleCodes: string[];
  userIds: string[];
  userExcludeIds: string[];
  clientTypes: string[];
  stages: string[];
};

type PolicyPack = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  enabled: boolean;
  source: "builtin" | "custom";
};

type PolicyRule = {
  id: string;
  packId: string;
  code: string;
  kind: "keyword" | "regex" | "pii";
  action: "block" | "redact" | "warn";
  severity: "low" | "medium" | "high" | "critical";
  message: string | null;
  payload: { keywords?: string[]; pattern?: string; piiType?: string };
  appliesTo: PolicyAppliesTo | null;
  status: "draft" | "active" | "disabled";
  updatedAt: string;
};

type PublishEvent = {
  id: string;
  version: number;
  publisher: string | null;
  publishedAt: string;
  status: "published" | "rolled_back";
};

type RuleForm = {
  id?: string;
  packId: string;
  code: string;
  kind: "keyword" | "regex" | "pii";
  action: "block" | "redact" | "warn";
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  payloadKeywords: string;
  payloadPattern: string;
  payloadPiiType: string;
  status: "draft" | "active" | "disabled";
  appliesDepartmentIds: string;
  appliesRoleCodes: string;
  appliesUserIds: string;
  appliesUserExcludeIds: string;
  appliesClientTypes: string;
  appliesStages: string;
};

function parseList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function summarizeAppliesTo(
  appliesTo: PolicyAppliesTo | null,
  t: ReturnType<typeof useTranslations<"pages.policy">>
): string {
  if (!appliesTo) return t("appliesInherit");
  const chunks: string[] = [];
  if (appliesTo.departmentIds.length === 1 && appliesTo.departmentIds[0] === "*") chunks.push(t("appliesAll"));
  else if (appliesTo.departmentIds.length > 0) chunks.push(t("appliesDepts", { count: appliesTo.departmentIds.length }));
  if (!(appliesTo.roleCodes.length === 1 && appliesTo.roleCodes[0] === "*") && appliesTo.roleCodes.length > 0) {
    chunks.push(t("appliesRoles", { count: appliesTo.roleCodes.length }));
  }
  if (!(appliesTo.clientTypes.length === 1 && appliesTo.clientTypes[0] === "*") && appliesTo.clientTypes.length > 0) {
    chunks.push(appliesTo.clientTypes.join("/"));
  }
  return chunks.join(" · ") || t("appliesAll");
}

function labelPolicyKind(kind: PolicyRule["kind"], t: ReturnType<typeof useTranslations<"pages.policy">>): string {
  if (kind === "keyword") return t("tabs.keyword");
  if (kind === "regex") return t("tabs.regex");
  return t("tabs.pii");
}

function labelPolicyAction(action: PolicyRule["action"], t: ReturnType<typeof useTranslations<"pages.policy">>): string {
  if (action === "block") return t("action.block");
  if (action === "redact") return t("action.redact");
  return t("action.warn");
}

export default function PolicyPage() {
  const t = useTranslations("pages.policy");
  const tc = useTranslations("common");
  const ts = useTranslations("shell");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("all");
  const [packs, setPacks] = useState<PolicyPack[]>([]);
  const [rules, setRules] = useState<PolicyRule[]>([]);
  const [publishes, setPublishes] = useState<PublishEvent[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sampleText, setSampleText] = useState("");
  const [testSummary, setTestSummary] = useState<string>("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pendingDeleteRule, setPendingDeleteRule] = useState<PolicyRule | null>(null);
  const [syncStatus, setSyncStatus] = useState<"unknown" | "pending" | "synced">("unknown");
  const [form, setForm] = useState<RuleForm>({
    packId: "",
    code: "",
    kind: "keyword",
    action: "warn",
    severity: "medium",
    message: "",
    payloadKeywords: "",
    payloadPattern: "",
    payloadPiiType: "email",
    status: "draft",
    appliesDepartmentIds: "*",
    appliesRoleCodes: "*",
    appliesUserIds: "",
    appliesUserExcludeIds: "",
    appliesClientTypes: "*",
    appliesStages: "request,response",
  });

  const latestPublish = publishes[0] ?? null;
  const latestPublishAtMs = latestPublish ? Date.parse(latestPublish.publishedAt) : null;
  const isDisabledPendingPublish = useCallback(
    (rule: PolicyRule) =>
      rule.status === "disabled" && (latestPublishAtMs === null || Date.parse(rule.updatedAt) > latestPublishAtMs),
    [latestPublishAtMs]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [packsRes, rulesRes, publishRes] = await Promise.all([
        adminFetch("/api/policy/packs", { cache: "no-store" }),
        adminFetch("/api/policy/rules", { cache: "no-store" }),
        adminFetch("/api/policy/publishes", { cache: "no-store" }),
      ]);
      const packsJson = (await packsRes.json()) as { message?: string; data?: { packs?: PolicyPack[] } };
      const rulesJson = (await rulesRes.json()) as { message?: string; data?: { rules?: PolicyRule[] } };
      const publishJson = (await publishRes.json()) as { message?: string; data?: { events?: PublishEvent[] } };
      if (!packsRes.ok) throw new Error(packsJson.message ?? t("toast.loadPacksFailed"));
      if (!rulesRes.ok) throw new Error(rulesJson.message ?? t("toast.loadRulesFailed"));
      if (!publishRes.ok) throw new Error(publishJson.message ?? t("toast.loadPublishFailed"));
      const nextPacks = packsJson.data?.packs ?? [];
      setPacks(nextPacks);
      setRules(rulesJson.data?.rules ?? []);
      setPublishes(publishJson.data?.events ?? []);
      setForm((prev) => ({ ...prev, packId: prev.packId || nextPacks[0]?.id || "" }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRules = useMemo(() => {
    const visibleRules = rules.filter((rule) => rule.status !== "disabled" || isDisabledPendingPublish(rule));
    if (tab === "all") return visibleRules;
    if (tab === "keyword" || tab === "regex" || tab === "pii") return visibleRules.filter((rule) => rule.kind === tab);
    return visibleRules;
  }, [rules, tab, isDisabledPendingPublish]);

  const resetForm = () => {
    setForm({
      packId: packs[0]?.id ?? "",
      code: "",
      kind: "keyword",
      action: "warn",
      severity: "medium",
      message: "",
      payloadKeywords: "",
      payloadPattern: "",
      payloadPiiType: "email",
      status: "draft",
      appliesDepartmentIds: "*",
      appliesRoleCodes: "*",
      appliesUserIds: "",
      appliesUserExcludeIds: "",
      appliesClientTypes: "*",
      appliesStages: "request,response",
    });
    setSampleText("");
    setTestSummary("");
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (rule: PolicyRule) => {
    setForm({
      id: rule.id,
      packId: rule.packId,
      code: rule.code,
      kind: rule.kind,
      action: rule.action,
      severity: rule.severity,
      message: rule.message ?? "",
      payloadKeywords: (rule.payload.keywords ?? []).join("\n"),
      payloadPattern: rule.payload.pattern ?? "",
      payloadPiiType: rule.payload.piiType ?? "email",
      status: rule.status,
      appliesDepartmentIds: (rule.appliesTo?.departmentIds ?? ["*"]).join(","),
      appliesRoleCodes: (rule.appliesTo?.roleCodes ?? ["*"]).join(","),
      appliesUserIds: (rule.appliesTo?.userIds ?? []).join(","),
      appliesUserExcludeIds: (rule.appliesTo?.userExcludeIds ?? []).join(","),
      appliesClientTypes: (rule.appliesTo?.clientTypes ?? ["*"]).join(","),
      appliesStages: (rule.appliesTo?.stages ?? ["request", "response"]).join(","),
    });
    setSampleText("");
    setTestSummary("");
    setDialogOpen(true);
  };

  const saveRule = async (mode: "draft" | "publish") => {
    const payload =
      form.kind === "keyword"
        ? { keywords: parseList(form.payloadKeywords) }
        : form.kind === "regex"
          ? { pattern: form.payloadPattern.trim() }
          : { piiType: form.payloadPiiType.trim() };
    const body = {
      packId: form.packId,
      code: form.code.trim(),
      kind: form.kind,
      action: form.action,
      severity: form.severity,
      message: form.message.trim() || null,
      payload,
      status: mode === "draft" ? "draft" : "active",
      appliesTo: {
        departmentIds: parseList(form.appliesDepartmentIds || "*"),
        roleCodes: parseList(form.appliesRoleCodes || "*"),
        userIds: parseList(form.appliesUserIds),
        userExcludeIds: parseList(form.appliesUserExcludeIds),
        clientTypes: parseList(form.appliesClientTypes || "*"),
        stages: parseList(form.appliesStages || "request,response"),
      },
    };
    const url = form.id ? `/api/policy/rules/${form.id}` : "/api/policy/rules";
    const method = form.id ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? t("toast.saveFailed"));
      return;
    }
    if (mode === "publish") {
      await triggerPublish();
    } else {
      toast.success(t("toast.draftSaved"));
    }
    setDialogOpen(false);
    await load();
  };

  const triggerPublish = async () => {
    const res = await adminFetch("/api/policy/publish", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? t("toast.publishFailed"));
      return;
    }
    toast.success(t("toast.published"));
    setSyncStatus("pending");
    for (let i = 0; i < 5; i += 1) {
      const health = await fetch("/healthz", { cache: "no-store" }).catch(() => null);
      if (health?.ok) {
        setSyncStatus("synced");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    setSyncStatus("unknown");
  };

  const deleteRule = async (id: string): Promise<boolean> => {
    const res = await fetch(`/api/policy/rules/${id}`, { method: "DELETE" });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? t("toast.disableFailed"));
      return false;
    }
    toast.success(t("toast.disabled"));
    await load();
    return true;
  };

  const restoreRule = async (id: string) => {
    const res = await fetch(`/api/policy/rules/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "draft" }),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? t("toast.restoreFailed"));
      return;
    }
    toast.success(t("toast.restored"));
    await load();
  };

  const requestDeleteRule = (rule: PolicyRule) => {
    setPendingDeleteRule(rule);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteRule = async () => {
    if (!pendingDeleteRule) return;
    const success = await deleteRule(pendingDeleteRule.id);
    if (success) {
      setDeleteDialogOpen(false);
      setPendingDeleteRule(null);
    }
  };

  const runTest = async () => {
    if (!form.id) {
      toast.error(t("test.saveFirst"));
      return;
    }
    const payload =
      form.kind === "keyword"
        ? { keywords: parseList(form.payloadKeywords) }
        : form.kind === "regex"
          ? { pattern: form.payloadPattern.trim() }
          : { piiType: form.payloadPiiType.trim() };
    const res = await adminFetch("/api/policy/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ruleIds: [form.id],
        sampleText,
        stage: "request",
        preview: {
          kind: form.kind,
          action: form.action,
          severity: form.severity,
          message: form.message.trim() || null,
          payload,
        },
      }),
    });
    const json = (await res.json()) as {
      message?: string;
      data?: { blocked?: boolean; hits?: unknown[]; redactedText?: string };
    };
    if (!res.ok || !json.data) {
      toast.error(json.message ?? t("test.failed"));
      return;
    }
    const hitCount = Array.isArray(json.data.hits) ? json.data.hits.length : 0;
    const parts = [t("test.hitSummary", { count: hitCount }), t("test.blockedSummary", { blocked: json.data.blocked ? t("test.yes") : t("test.no") })];
    const redacted = json.data.redactedText ?? sampleText;
    if (redacted !== sampleText && hitCount > 0) {
      const clip = redacted.length > 160 ? `${redacted.slice(0, 160)}…` : redacted;
      parts.push(t("test.redactPreviewSummary", { text: clip }));
    }
    setTestSummary(parts.join(" · "));
  };

  const togglePack = async (pack: PolicyPack, enabled: boolean) => {
    const res = await fetch(`/api/policy/packs/${encodeURIComponent(pack.code)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? t("toast.updateFailed"));
      return;
    }
    toast.success(enabled ? t("toast.packEnabledNamed", { name: pack.name }) : t("toast.packDisabledNamed", { name: pack.name }));
    await load();
  };

  const rollback = async (id: string) => {
    const res = await fetch(`/api/policy/publishes/${encodeURIComponent(id)}/rollback`, { method: "POST" });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? t("toast.rollbackFailed"));
      return;
    }
    toast.success(t("toast.rolledBack"));
    await load();
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
                <BreadcrumbPage>{t("breadcrumbPolicy")}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title={t("breadcrumbPolicy")}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("newRule")}
            </Button>
            <Button size="sm" onClick={() => void triggerPublish()}>
              <Send className="h-4 w-4" />
              {t("publish")}
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t("statusTitle")}
            <Badge variant="outline">v{latestPublish?.version ?? "-"}</Badge>
            <Badge variant={syncStatus === "synced" ? "success" : "secondary"}>
              {syncStatus === "synced" ? t("gatewaySynced") : syncStatus === "pending" ? t("gatewayPending") : t("syncUnknown")}
            </Badge>
          </CardTitle>
          <CardDescription>
            {latestPublish
              ? t("lastPublishFormatted", { date: new Date(latestPublish.publishedAt).toLocaleString(), publisher: latestPublish.publisher ?? t("unknownPublisher") })
              : t("notPublished")}
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">{t("tabs.all")}</TabsTrigger>
          <TabsTrigger value="keyword">{t("tabs.keyword")}</TabsTrigger>
          <TabsTrigger value="regex">{t("tabs.regex")}</TabsTrigger>
          <TabsTrigger value="pii">{t("tabs.pii")}</TabsTrigger>
          <TabsTrigger value="packs">{t("tabs.packs")}</TabsTrigger>
          <TabsTrigger value="publishes">{t("tabs.publishes")}</TabsTrigger>
        </TabsList>

        {["all", "keyword", "regex", "pii"].map((key) => (
          <TabsContent key={key} value={key} className="space-y-3 pt-3">
            {filteredRules.map((rule) => (
              <div
                key={rule.id}
                className={`rounded-md border p-3 ${rule.status === "disabled" ? "border-border bg-muted/40 text-text-faint" : "border-border"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{rule.code}</span>
                      <Badge variant="outline">{labelPolicyKind(rule.kind, t)}</Badge>
                      <Badge variant="secondary">{labelPolicyAction(rule.action, t)}</Badge>
                      <Badge variant={rule.status === "active" ? "success" : "outline"}>
                        {rule.status === "active" ? t("status.active") : rule.status === "draft" ? t("status.draft") : t("status.disabled")}
                      </Badge>
                    </div>
                    <p className="text-sm text-text-subtle">{rule.message || t("noMessage")}</p>
                    <p className="text-xs text-text-faint">{t("appliesTo")}{summarizeAppliesTo(rule.appliesTo, t)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(rule)} disabled={rule.status === "disabled"}>
                      <Pencil className="h-4 w-4" />
                      {t("edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => requestDeleteRule(rule)}
                      disabled={rule.status === "disabled"}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("delete")}
                    </Button>
                    {rule.status === "disabled" ? (
                      <Button size="sm" variant="destructive" onClick={() => void restoreRule(rule.id)}>
                        {t("restore")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            {filteredRules.length === 0 ? <p className="text-sm text-text-faint">{loading ? t("loadingRules") : t("emptyRules")}</p> : null}
          </TabsContent>
        ))}

        <TabsContent value="packs" className="pt-3">
          <Card>
            <CardHeader>
              <CardTitle>{t("tabs.packs")}</CardTitle>
              <CardDescription>{t("packsDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {packs.map((pack) => (
                <div key={pack.id} className="flex items-center justify-between rounded-md border border-border px-3 py-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{pack.name}</span>
                      <Badge variant={pack.enabled ? "success" : "secondary"}>{pack.enabled ? t("packEnabled") : t("packDisabled")}</Badge>
                      <Badge variant="outline">{pack.source === "builtin" ? t("packBuiltin") : t("packCustom")}</Badge>
                    </div>
                    <p className="text-sm text-text-subtle">{pack.description || t("noDescription")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {pack.enabled ? <ShieldCheck className="h-4 w-4 text-green-600" /> : <ShieldX className="h-4 w-4 text-gray-500" />}
                    <Checkbox checked={pack.enabled} onCheckedChange={(next) => void togglePack(pack, next === true)} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="publishes" className="pt-3">
          <Card>
            <CardHeader>
              <CardTitle>{t("tabs.publishes")}</CardTitle>
              <CardDescription>{t("publishesDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {publishes.map((event) => (
                <div key={event.id} className="flex items-center justify-between rounded-md border border-border px-3 py-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">v{event.version}</Badge>
                      <Badge variant={event.status === "published" ? "success" : "secondary"}>{event.status}</Badge>
                    </div>
                    <p className="text-sm text-text-subtle">
                      {new Date(event.publishedAt).toLocaleString()} · {event.publisher ?? t("unknownPublisher")}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void rollback(event.id)}>
                    <RotateCcw className="h-4 w-4" />
                    {t("rollback")}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{form.id ? t("dialog.editTitle") : t("newRule")}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("dialog.codeLabel")}</Label>
              <Input value={form.code} onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>{t("tabs.packs")}</Label>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={form.packId}
                onChange={(e) => setForm((prev) => ({ ...prev, packId: e.target.value }))}
              >
                {packs.map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>{t("dialog.kindLabel")}</Label>
              <select className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.kind} onChange={(e) => setForm((prev) => ({ ...prev, kind: e.target.value as RuleForm["kind"] }))}>
                <option value="keyword">{t("tabs.keyword")}</option>
                <option value="regex">{t("tabs.regex")}</option>
                <option value="pii">{t("tabs.pii")}</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>{t("dialog.actionLabel")}</Label>
              <select className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.action} onChange={(e) => setForm((prev) => ({ ...prev, action: e.target.value as RuleForm["action"] }))}>
                <option value="warn">{t("dialog.actionWarn")}</option>
                <option value="redact">{t("dialog.actionRedact")}</option>
                <option value="block">{t("dialog.actionBlock")}</option>
              </select>
              <p className="text-xs text-text-faint">{t("dialog.actionHint")}</p>
            </div>
            <div className="col-span-2 space-y-1">
              <Label>{t("dialog.messageLabel")}</Label>
              <Input value={form.message} onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))} />
            </div>
            {form.kind === "keyword" ? (
              <div className="col-span-2 space-y-1">
                <Label>{t("dialog.keywordsLabel")}</Label>
                <Textarea value={form.payloadKeywords} onChange={(e) => setForm((prev) => ({ ...prev, payloadKeywords: e.target.value }))} />
              </div>
            ) : null}
            {form.kind === "regex" ? (
              <div className="col-span-2 space-y-1">
                <Label>{t("dialog.patternLabel")}</Label>
                <Input value={form.payloadPattern} onChange={(e) => setForm((prev) => ({ ...prev, payloadPattern: e.target.value }))} />
              </div>
            ) : null}
            {form.kind === "pii" ? (
              <div className="col-span-2 space-y-1">
                <Label>{t("dialog.piiTypeLabel")}</Label>
                <Input value={form.payloadPiiType} onChange={(e) => setForm((prev) => ({ ...prev, payloadPiiType: e.target.value }))} />
              </div>
            ) : null}
            <div className="col-span-2 rounded-md border border-border p-3">
              <p className="mb-2 text-sm font-medium">{t("dialog.scopeTitle")}</p>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder={t("dialog.scopeDeptPlaceholder")} value={form.appliesDepartmentIds} onChange={(e) => setForm((prev) => ({ ...prev, appliesDepartmentIds: e.target.value }))} />
                <Input placeholder={t("dialog.scopeRolePlaceholder")} value={form.appliesRoleCodes} onChange={(e) => setForm((prev) => ({ ...prev, appliesRoleCodes: e.target.value }))} />
                <Input placeholder={t("dialog.scopeUserPlaceholder")} value={form.appliesUserIds} onChange={(e) => setForm((prev) => ({ ...prev, appliesUserIds: e.target.value }))} />
                <Input placeholder={t("dialog.scopeExcludePlaceholder")} value={form.appliesUserExcludeIds} onChange={(e) => setForm((prev) => ({ ...prev, appliesUserExcludeIds: e.target.value }))} />
                <Input placeholder={t("dialog.scopeClientPlaceholder")} value={form.appliesClientTypes} onChange={(e) => setForm((prev) => ({ ...prev, appliesClientTypes: e.target.value }))} />
                <Input placeholder={t("dialog.scopeStagesPlaceholder")} value={form.appliesStages} onChange={(e) => setForm((prev) => ({ ...prev, appliesStages: e.target.value }))} />
              </div>
            </div>
            <div className="col-span-2 rounded-md border border-border p-3">
              <p className="mb-2 text-sm font-medium">{t("dialog.testTitle")}</p>
              <Textarea value={sampleText} onChange={(e) => setSampleText(e.target.value)} placeholder={t("dialog.testPlaceholder")} />
              <div className="mt-2 flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void runTest()}>
                  <TestTube2 className="h-4 w-4" />
                  {t("dialog.runTest")}
                </Button>
                {testSummary ? <Badge variant="outline">{testSummary}</Badge> : null}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button variant="outline" onClick={() => void saveRule("draft")}>
              {t("dialog.saveDraft")}
            </Button>
            <Button onClick={() => void saveRule("publish")}>{t("dialog.publishNow")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setPendingDeleteRule(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("deleteDialog.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-text-subtle">
            <p>
              {t("deleteDialog.body")}{" "}
              <span className="font-semibold text-text-strong">{pendingDeleteRule?.code ?? "-"}</span>
              {t("deleteDialog.bodySuffix")}
            </p>
            <p>{t("deleteDialog.restoreHint")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void confirmDeleteRule()}>
              {t("deleteDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
