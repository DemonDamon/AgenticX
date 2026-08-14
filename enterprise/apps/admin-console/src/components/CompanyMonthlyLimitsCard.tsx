"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Skeleton,
  toast,
} from "@agenticx/ui";
import { Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { adminFetch, readAdminJsonResponse } from "../lib/admin-client-auth";
import {
  companyMonthlyLimits,
  withCompanyMonthlyLimits,
  type BudgetConfig,
} from "../lib/company-monthly-limits";

type BudgetEnvelope = {
  code: string;
  message: string;
  data?: { budget?: BudgetConfig };
};

export function CompanyMonthlyLimitsCard() {
  const t = useTranslations("pages.iam.bulkImport.monthlyLimits");
  const [budget, setBudget] = useState<BudgetConfig | null>(null);
  const [tokens, setTokens] = useState(0);
  const [costUsd, setCostUsd] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const applyBudget = useCallback((next: BudgetConfig) => {
    const limits = companyMonthlyLimits(next);
    setBudget(next);
    setTokens(limits.tokens);
    setCostUsd(limits.costUsd);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminFetch("/api/metering/budget", { cache: "no-store" });
      const json = await readAdminJsonResponse<BudgetEnvelope>(response, t("loadFailed"));
      if (!response.ok || json.code !== "00000" || !json.data?.budget) {
        throw new Error(json.message || t("loadFailed"));
      }
      applyBudget(json.data.budget);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("loadFailed"));
      setBudget(null);
      setTokens(0);
      setCostUsd(0);
    } finally {
      setLoading(false);
    }
  }, [applyBudget, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!budget || saving) return;
    setSaving(true);
    try {
      const nextBudget = withCompanyMonthlyLimits(budget, { tokens, costUsd });
      const response = await adminFetch("/api/metering/budget", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(nextBudget),
      });
      const json = await readAdminJsonResponse<BudgetEnvelope>(response, t("saveFailed"));
      if (!response.ok || json.code !== "00000" || !json.data?.budget) {
        throw new Error(json.message || t("saveFailed"));
      }
      applyBudget(json.data.budget);
      toast.success(t("saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription className="mt-1">{t("description")}</CardDescription>
        </div>
        <Button size="sm" onClick={() => void save()} disabled={loading || saving || !budget}>
          <Save className="h-4 w-4" />
          {saving ? t("saving") : t("save")}
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : (
          <div className="grid overflow-hidden rounded-lg border border-border md:grid-cols-2 md:divide-x md:divide-border">
            <div className="space-y-2 p-4">
              <Label htmlFor="company-monthly-token-limit">{t("tokenLabel")}</Label>
              <Input
                id="company-monthly-token-limit"
                inputMode="numeric"
                value={tokens || ""}
                placeholder={t("unlimitedPlaceholder")}
                onChange={(event) => {
                  const value = event.target.value.replace(/[^0-9]/g, "");
                  setTokens(value ? Number(value) : 0);
                }}
                disabled={!budget || saving}
              />
              <p className="text-xs leading-5 text-muted-foreground">{t("tokenDescription")}</p>
            </div>
            <div className="space-y-2 border-t border-border p-4 md:border-t-0">
              <Label htmlFor="company-monthly-cost-limit">{t("costLabel")}</Label>
              <Input
                id="company-monthly-cost-limit"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={costUsd || ""}
                placeholder={t("unlimitedPlaceholder")}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setCostUsd(Number.isFinite(value) && value > 0 ? value : 0);
                }}
                disabled={!budget || saving}
              />
              <p className="text-xs leading-5 text-muted-foreground">{t("costDescription")}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
