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
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";

type ComplianceConfig = {
  tenantId: string;
  dataResidency: string | null;
  crossBorderAction: "allow" | "block" | "require_approval";
  auditRetentionYears: number;
  appendOnly: boolean;
  updatedAt: string;
};

export default function CompliancePage() {
  const t = useTranslations("pages.admin.compliance");
  const tc = useTranslations("common");
  const ts = useTranslations("shell");
  const [config, setConfig] = useState<ComplianceConfig | null>(null);
  const [dataResidency, setDataResidency] = useState("");
  const [crossBorderAction, setCrossBorderAction] = useState<ComplianceConfig["crossBorderAction"]>("allow");
  const [retentionYears, setRetentionYears] = useState("6");
  const [appendOnly, setAppendOnly] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await adminFetch("/api/admin/compliance");
    const payload = (await res.json()) as { data?: { config?: ComplianceConfig } };
    const cfg = payload.data?.config;
    if (!cfg) return;
    setConfig(cfg);
    setDataResidency(cfg.dataResidency ?? "");
    setCrossBorderAction(cfg.crossBorderAction);
    setRetentionYears(String(cfg.auditRetentionYears));
    setAppendOnly(cfg.appendOnly);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await adminFetch("/api/admin/compliance", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dataResidency: dataResidency.trim() || null,
          crossBorderAction,
          auditRetentionYears: Number(retentionYears),
          appendOnly,
        }),
      });
      const payload = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(payload.message ?? t("toastSaveFailed"));
      toast.success(t("toastSaved"));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toastSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t("title")} description={t("description")} />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/dashboard">{ts("adminLabel")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{t("breadcrumbPage")}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Card>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="dataResidency">{t("dataResidency")}</Label>
            <Input
              id="dataResidency"
              value={dataResidency}
              onChange={(e) => setDataResidency(e.target.value)}
              placeholder={t("dataResidencyPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("crossBorderAction")}</Label>
            <Select value={crossBorderAction} onValueChange={(v) => setCrossBorderAction(v as ComplianceConfig["crossBorderAction"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="allow">{t("actionAllow")}</SelectItem>
                <SelectItem value="require_approval">{t("actionApproval")}</SelectItem>
                <SelectItem value="block">{t("actionBlock")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="retention">{t("retentionYears")}</Label>
            <Input
              id="retention"
              type="number"
              min={1}
              max={99}
              value={retentionYears}
              onChange={(e) => setRetentionYears(e.target.value)}
            />
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={appendOnly} onChange={(e) => setAppendOnly(e.target.checked)} />
              {t("appendOnly")}
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? t("saving") : tc("actions.save")}
        </Button>
        {config?.updatedAt ? (
          <span className="text-xs text-muted-foreground">
            {t("lastUpdated")} {config.updatedAt}
          </span>
        ) : null}
        <Link href="/audit" className="text-sm text-primary hover:underline">
          {t("viewCrossBorderAudit")}
        </Link>
      </div>
    </div>
  );
}
