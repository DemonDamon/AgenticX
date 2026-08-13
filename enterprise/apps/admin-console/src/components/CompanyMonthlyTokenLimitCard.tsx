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
import { adminFetch, readAdminJsonResponse } from "../lib/admin-client-auth";
import {
  companyMonthlyTokenLimit,
  withCompanyMonthlyTokenLimit,
  type BudgetConfig,
} from "../lib/company-token-budget";

type BudgetEnvelope = {
  code: string;
  message: string;
  data?: { budget?: BudgetConfig };
};

export function CompanyMonthlyTokenLimitCard() {
  const [budget, setBudget] = useState<BudgetConfig | null>(null);
  const [limit, setLimit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminFetch("/api/metering/budget", { cache: "no-store" });
      const json = await readAdminJsonResponse<BudgetEnvelope>(response, "加载公司额度失败");
      if (!response.ok || json.code !== "00000" || !json.data?.budget) {
        throw new Error(json.message || "加载公司额度失败");
      }
      setBudget(json.data.budget);
      setLimit(companyMonthlyTokenLimit(json.data.budget));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载公司额度失败");
      setBudget(null);
      setLimit(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!budget || saving) return;
    setSaving(true);
    try {
      const nextBudget = withCompanyMonthlyTokenLimit(budget, limit);
      const response = await adminFetch("/api/metering/budget", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(nextBudget),
      });
      const json = await readAdminJsonResponse<BudgetEnvelope>(response, "保存公司额度失败");
      if (!response.ok || json.code !== "00000" || !json.data?.budget) {
        throw new Error(json.message || "保存公司额度失败");
      }
      setBudget(json.data.budget);
      setLimit(companyMonthlyTokenLimit(json.data.budget));
      toast.success("公司月度 Token 上限已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存公司额度失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle>全公司月度 Token 上限</CardTitle>
          <CardDescription className="mt-1">
            统计公司内所有成员的月度 Token 消耗；达到上限后停止新的模型请求。设置为 0 表示不限制。
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => void save()} disabled={loading || saving || !budget}>
          <Save className="h-4 w-4" />
          {saving ? "保存中…" : "保存"}
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-10 max-w-xl" />
        ) : (
          <div className="flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="company-monthly-token-limit">每月 Token 预算上限</Label>
              <Input
                id="company-monthly-token-limit"
                inputMode="numeric"
                value={limit || ""}
                placeholder="0（不限额）"
                onChange={(event) => {
                  const value = event.target.value.replace(/[^0-9]/g, "");
                  setLimit(value ? Number(value) : 0);
                }}
                disabled={!budget || saving}
              />
            </div>
            <Button
              type="button"
              variant={limit <= 0 ? "secondary" : "outline"}
              onClick={() => setLimit(0)}
              disabled={!budget || saving}
            >
              {limit <= 0 ? "不限额（当前）" : "设为不限额"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
