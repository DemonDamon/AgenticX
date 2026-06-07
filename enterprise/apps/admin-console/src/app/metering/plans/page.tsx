"use client";

import { adminFetch } from "../../../lib/admin-client-auth";
import { useCallback, useEffect, useState } from "react";
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
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@agenticx/ui";
import { Plus, RefreshCcw, Rocket, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

type PlanPeriod = "month" | "week";
type PlanStatus = "draft" | "active" | "archived";
type PlanScopeType = "tenant" | "dept" | "user";

type QuotaPlan = {
  id: string;
  tenantId: string;
  name: string;
  monthlyTokens: number;
  rpm: number;
  tpm: number;
  maxConcurrency: number;
  models: string[];
  period: PlanPeriod;
  status: PlanStatus;
  createdAt: string;
  updatedAt: string;
};

type QuotaPlanAssignment = {
  id: string;
  tenantId: string;
  planId: string;
  scopeType: PlanScopeType;
  scopeId: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  pendingPlanId: string | null;
  lastRolloverKey: string | null;
  createdAt: string;
  updatedAt: string;
};

const EMPTY_FORM = {
  name: "",
  monthlyTokens: "10000000",
  rpm: "60",
  tpm: "100000",
  maxConcurrency: "10",
  models: "",
  period: "month" as PlanPeriod,
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function statusVariant(status: PlanStatus): "default" | "secondary" | "destructive" {
  if (status === "active") return "default";
  if (status === "archived") return "destructive";
  return "secondary";
}

export default function QuotaPlansPage() {
  const t = useTranslations("pages.ops.quotaPlans");
  const tc = useTranslations("common");
  const [plans, setPlans] = useState<QuotaPlan[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<QuotaPlanAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [assignScopeType, setAssignScopeType] = useState<PlanScopeType>("dept");
  const [assignScopeId, setAssignScopeId] = useState("");
  const [effectiveNextPeriod, setEffectiveNextPeriod] = useState(false);

  const selected = plans.find((p) => p.id === selectedId) ?? null;

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/metering/plans", { cache: "no-store" });
      const json = (await res.json()) as { data?: { plans?: QuotaPlan[] } };
      setPlans(json.data?.plans ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAssignments = useCallback(async (planId: string) => {
    const res = await adminFetch(`/api/metering/plans/${planId}/assign`, { cache: "no-store" });
    const json = (await res.json()) as { data?: { assignments?: QuotaPlanAssignment[] } };
    setAssignments(json.data?.assignments ?? []);
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  useEffect(() => {
    if (selectedId) void loadAssignments(selectedId);
    else setAssignments([]);
  }, [selectedId, loadAssignments]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setSelectedId(null);
    setAssignments([]);
  };

  const selectPlan = (plan: QuotaPlan) => {
    setSelectedId(plan.id);
    setForm({
      name: plan.name,
      monthlyTokens: String(plan.monthlyTokens),
      rpm: String(plan.rpm),
      tpm: String(plan.tpm),
      maxConcurrency: String(plan.maxConcurrency),
      models: plan.models.join(", "),
      period: plan.period,
    });
  };

  const createPlan = async () => {
    if (!form.name.trim()) {
      toast.error(t("toast.nameRequired"));
      return;
    }
    const res = await adminFetch("/api/metering/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        monthlyTokens: Number(form.monthlyTokens),
        rpm: Number(form.rpm),
        tpm: Number(form.tpm),
        maxConcurrency: Number(form.maxConcurrency),
        models: form.models
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        period: form.period,
      }),
    });
    const json = (await res.json()) as { message?: string; data?: { plan?: QuotaPlan } };
    if (!res.ok) {
      toast.error(json.message ?? tc("states.error"));
      return;
    }
    toast.success(t("toast.created"));
    resetForm();
    await loadPlans();
    if (json.data?.plan) selectPlan(json.data.plan);
  };

  const savePlan = async () => {
    if (!selected) return;
    const res = await adminFetch(`/api/metering/plans/${selected.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        monthlyTokens: Number(form.monthlyTokens),
        rpm: Number(form.rpm),
        tpm: Number(form.tpm),
        maxConcurrency: Number(form.maxConcurrency),
        models: form.models
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        period: form.period,
      }),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? tc("states.error"));
      return;
    }
    toast.success(t("toast.saved"));
    await loadPlans();
  };

  const publishPlan = async () => {
    if (!selected) return;
    const res = await adminFetch(`/api/metering/plans/${selected.id}/publish`, { method: "POST" });
    const json = (await res.json()) as { message?: string; data?: { mapped?: number } };
    if (!res.ok) {
      toast.error(json.message ?? tc("states.error"));
      return;
    }
    toast.success(t("toast.published", { count: json.data?.mapped ?? 0 }));
    await loadPlans();
    if (selectedId) await loadAssignments(selectedId);
  };

  const archivePlan = async () => {
    if (!selected) return;
    const res = await adminFetch(`/api/metering/plans/${selected.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? tc("states.error"));
      return;
    }
    toast.success(t("toast.archived"));
    resetForm();
    await loadPlans();
  };

  const deletePlan = async () => {
    if (!selected || selected.status !== "draft") return;
    const res = await adminFetch(`/api/metering/plans/${selected.id}`, { method: "DELETE" });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? tc("states.error"));
      return;
    }
    toast.success(t("toast.deleted"));
    resetForm();
    await loadPlans();
  };

  const assignPlan = async () => {
    if (!selected) return;
    if (assignScopeType !== "tenant" && !assignScopeId.trim()) {
      toast.error(t("toast.scopeRequired"));
      return;
    }
    const res = await adminFetch(`/api/metering/plans/${selected.id}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scopeType: assignScopeType,
        scopeId: assignScopeId.trim(),
        effectiveNextPeriod,
      }),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? tc("states.error"));
      return;
    }
    toast.success(t("toast.assigned"));
    await loadAssignments(selected.id);
  };

  const cancelAssignment = async (assignmentId: string) => {
    if (!selected) return;
    const res = await adminFetch(`/api/metering/plans/${selected.id}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel", assignmentId }),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? tc("states.error"));
      return;
    }
    toast.success(t("toast.unassigned"));
    await loadAssignments(selected.id);
  };

  const runRollover = async () => {
    const res = await adminFetch("/api/metering/plans/rollover", { method: "POST" });
    const json = (await res.json()) as { message?: string; data?: { results?: Array<{ skipped?: boolean }> } };
    if (!res.ok) {
      toast.error(json.message ?? tc("states.error"));
      return;
    }
    const count = (json.data?.results ?? []).filter((r) => !r.skipped).length;
    toast.success(t("toast.rollover", { count }));
    if (selectedId) await loadAssignments(selectedId);
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadPlans()} disabled={loading}>
              <RefreshCcw className="mr-1 h-4 w-4" />
              {tc("actions.refresh")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void runRollover()}>
              {t("actions.rollover")}
            </Button>
          </div>
        }
      />

      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/">{tc("breadcrumb.home")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/metering">{tc("breadcrumb.metering")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{t("title")}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>{t("listTitle")}</CardTitle>
            <CardDescription>{t("listDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            {plans.length === 0 && !loading ? (
              <EmptyState title={t("empty")} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("fields.name")}</TableHead>
                    <TableHead>{t("fields.monthlyTokens")}</TableHead>
                    <TableHead>{t("fields.period")}</TableHead>
                    <TableHead>{t("fields.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.map((plan) => (
                    <TableRow
                      key={plan.id}
                      className={selectedId === plan.id ? "bg-muted/50 cursor-pointer" : "cursor-pointer"}
                      onClick={() => selectPlan(plan)}
                    >
                      <TableCell className="font-medium">{plan.name}</TableCell>
                      <TableCell>{formatTokens(plan.monthlyTokens)}</TableCell>
                      <TableCell>{plan.period === "week" ? t("period.week") : t("period.month")}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(plan.status)}>{t(`status.${plan.status}`)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{selected ? t("editTitle") : t("createTitle")}</CardTitle>
            <CardDescription>{selected ? t("editDesc") : t("createDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="plan-name">{t("fields.name")}</Label>
              <Input
                id="plan-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t("placeholders.name")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan-tokens">{t("fields.monthlyTokens")}</Label>
              <Input
                id="plan-tokens"
                type="number"
                value={form.monthlyTokens}
                onChange={(e) => setForm((f) => ({ ...f, monthlyTokens: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-2">
                <Label htmlFor="plan-rpm">RPM</Label>
                <Input
                  id="plan-rpm"
                  type="number"
                  value={form.rpm}
                  onChange={(e) => setForm((f) => ({ ...f, rpm: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-tpm">TPM</Label>
                <Input
                  id="plan-tpm"
                  type="number"
                  value={form.tpm}
                  onChange={(e) => setForm((f) => ({ ...f, tpm: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-conc">{t("fields.maxConcurrency")}</Label>
                <Input
                  id="plan-conc"
                  type="number"
                  value={form.maxConcurrency}
                  onChange={(e) => setForm((f) => ({ ...f, maxConcurrency: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan-models">{t("fields.models")}</Label>
              <Input
                id="plan-models"
                value={form.models}
                onChange={(e) => setForm((f) => ({ ...f, models: e.target.value }))}
                placeholder={t("placeholders.models")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("fields.period")}</Label>
              <Select value={form.period} onValueChange={(v) => setForm((f) => ({ ...f, period: v as PlanPeriod }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">{t("period.month")}</SelectItem>
                  <SelectItem value="week">{t("period.week")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              {!selected ? (
                <Button onClick={() => void createPlan()}>
                  <Plus className="mr-1 h-4 w-4" />
                  {tc("actions.create")}
                </Button>
              ) : (
                <>
                  <Button onClick={() => void savePlan()} disabled={selected.status === "archived"}>
                    {tc("actions.save")}
                  </Button>
                  {selected.status !== "archived" && (
                    <Button variant="secondary" onClick={() => void publishPlan()}>
                      <Rocket className="mr-1 h-4 w-4" />
                      {t("actions.publish")}
                    </Button>
                  )}
                  {selected.status === "draft" && (
                    <Button variant="destructive" size="icon" onClick={() => void deletePlan()}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                  {selected.status === "active" && (
                    <Button variant="outline" onClick={() => void archivePlan()}>
                      {t("actions.archive")}
                    </Button>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {selected && selected.status !== "archived" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("assignTitle")}</CardTitle>
            <CardDescription>{t("assignDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>{t("fields.scopeType")}</Label>
                <Select value={assignScopeType} onValueChange={(v) => setAssignScopeType(v as PlanScopeType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tenant">{t("scope.tenant")}</SelectItem>
                    <SelectItem value="dept">{t("scope.dept")}</SelectItem>
                    <SelectItem value="user">{t("scope.user")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="scope-id">{t("fields.scopeId")}</Label>
                <Input
                  id="scope-id"
                  value={assignScopeId}
                  onChange={(e) => setAssignScopeId(e.target.value)}
                  placeholder={assignScopeType === "tenant" ? t("placeholders.tenantScope") : t("placeholders.scopeId")}
                  disabled={assignScopeType === "tenant"}
                />
              </div>
              <div className="flex items-end gap-2 pb-2">
                <Checkbox
                  id="next-period"
                  checked={effectiveNextPeriod}
                  onCheckedChange={(v) => setEffectiveNextPeriod(Boolean(v))}
                />
                <Label htmlFor="next-period" className="cursor-pointer text-sm">
                  {t("fields.effectiveNextPeriod")}
                </Label>
              </div>
            </div>
            <Button onClick={() => void assignPlan()}>{t("actions.assign")}</Button>

            {assignments.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("fields.scopeType")}</TableHead>
                    <TableHead>{t("fields.scopeId")}</TableHead>
                    <TableHead>{t("fields.periodEnd")}</TableHead>
                    <TableHead>{t("fields.status")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{t(`scope.${row.scopeType}`)}</TableCell>
                      <TableCell className="font-mono text-xs">{row.scopeId}</TableCell>
                      <TableCell>{new Date(row.periodEnd).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Badge variant={row.status === "active" ? "default" : "secondary"}>{row.status}</Badge>
                        {row.pendingPlanId && (
                          <span className="ml-2 text-xs text-muted-foreground">{t("pendingUpgrade")}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.status === "active" && (
                          <Button variant="ghost" size="sm" onClick={() => void cancelAssignment(row.id)}>
                            {t("actions.unassign")}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
