"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
import { ExternalLink, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { adminFetch, readAdminJsonResponse } from "../lib/admin-client-auth";
import {
  defaultMemberQuotaLimits,
  normalizeDefaultMemberTokenLimit,
  withDefaultMemberQuotaLimits,
  type DefaultMemberQuotaConfig,
} from "../lib/default-member-quota";

type QuotaEnvelope = {
  code: string;
  message: string;
  data?: { quota?: DefaultMemberQuotaConfig };
};

export function DefaultMemberQuotaCard() {
  const t = useTranslations("pages.iam.bulkImport.monthlyLimits");
  const [quota, setQuota] = useState<DefaultMemberQuotaConfig | null>(null);
  const [dailyTokens, setDailyTokens] = useState(0);
  const [weeklyTokens, setWeeklyTokens] = useState(0);
  const [monthlyTokens, setMonthlyTokens] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const applyQuota = useCallback((next: DefaultMemberQuotaConfig) => {
    const limits = defaultMemberQuotaLimits(next);
    setQuota(next);
    setDailyTokens(limits.dailyTokens);
    setWeeklyTokens(limits.weeklyTokens);
    setMonthlyTokens(limits.monthlyTokens);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminFetch("/api/metering/quota", { cache: "no-store" });
      const json = await readAdminJsonResponse<QuotaEnvelope>(
        response,
        t("memberQuotaLoadFailed"),
      );
      if (!response.ok || json.code !== "00000" || !json.data?.quota) {
        throw new Error(json.message || t("memberQuotaLoadFailed"));
      }
      applyQuota(json.data.quota);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("memberQuotaLoadFailed"));
      setQuota(null);
      setDailyTokens(0);
      setWeeklyTokens(0);
      setMonthlyTokens(0);
    } finally {
      setLoading(false);
    }
  }, [applyQuota, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!quota || saving) return;
    setSaving(true);
    try {
      const update = withDefaultMemberQuotaLimits(quota, {
        dailyTokens,
        weeklyTokens,
        monthlyTokens,
      });
      const response = await adminFetch("/api/metering/quota", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
      });
      const json = await readAdminJsonResponse<QuotaEnvelope>(
        response,
        t("memberQuotaSaveFailed"),
      );
      if (response.status === 409) {
        toast.error(t("memberQuotaConflict"));
        await load();
        return;
      }
      if (!response.ok || json.code !== "00000" || !json.data?.quota) {
        throw new Error(json.message || t("memberQuotaSaveFailed"));
      }
      applyQuota(json.data.quota);
      toast.success(t("memberQuotaSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("memberQuotaSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const setLimit = (setter: (value: number) => void, raw: string) => {
    setter(normalizeDefaultMemberTokenLimit(raw));
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle>{t("memberQuotaTitle")}</CardTitle>
          <CardDescription className="mt-1">{t("memberQuotaDescription")}</CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/metering/quota">
              {t("memberQuotaAdvanced")}
              <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={loading || saving || !quota}
          >
            <Save className="h-4 w-4" />
            {saving ? t("memberQuotaSaving") : t("memberQuotaSave")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="default-member-daily-token-limit">
                  {t("memberQuotaDailyLabel")}
                </Label>
                <Input
                  id="default-member-daily-token-limit"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={dailyTokens}
                  placeholder={t("memberQuotaUnlimitedPlaceholder")}
                  onChange={(event) => setLimit(setDailyTokens, event.target.value)}
                  disabled={!quota || saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="default-member-weekly-token-limit">
                  {t("memberQuotaWeeklyLabel")}
                </Label>
                <Input
                  id="default-member-weekly-token-limit"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={weeklyTokens}
                  placeholder={t("memberQuotaUnlimitedPlaceholder")}
                  onChange={(event) => setLimit(setWeeklyTokens, event.target.value)}
                  disabled={!quota || saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="default-member-monthly-token-limit">
                  {t("memberQuotaMonthlyLabel")}
                </Label>
                <Input
                  id="default-member-monthly-token-limit"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={monthlyTokens}
                  placeholder={t("memberQuotaUnlimitedPlaceholder")}
                  onChange={(event) => setLimit(setMonthlyTokens, event.target.value)}
                  disabled={!quota || saving}
                />
              </div>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("memberQuotaUnlimitedHint")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
