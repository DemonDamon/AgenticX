"use client";

import { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, PageHeader } from "@agenticx/ui";
import { useTranslations } from "next-intl";
import { Shield } from "lucide-react";
import {
  SAMPLE_MASKING_POLICY,
  SAMPLE_SECURITY_ROWS,
  maskRows,
} from "../../../lib/data-security-fixture";

const ROLES = ["admin", "analyst", "guest", "outsider"] as const;
const PREVIEW_ROLES = ["admin", "analyst", "guest"] as const;

type QueryResult = {
  status: number;
  code?: string;
  message?: string;
  reason?: string;
  phone?: string | null;
  masked?: boolean;
};

export default function DataSecuritySection() {
  const t = useTranslations("pages.admin.dataSecurity");
  const [role, setRole] = useState<(typeof PREVIEW_ROLES)[number]>("analyst");
  const [queryRole, setQueryRole] = useState<(typeof ROLES)[number]>("analyst");
  const queryRoleRef = useRef<(typeof ROLES)[number]>("analyst");
  const [queryBusy, setQueryBusy] = useState(false);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const masked = useMemo(() => maskRows(SAMPLE_SECURITY_ROWS, role), [role]);
  const phone = masked[0]?.phone;

  async function runQuery() {
    setQueryBusy(true);
    setQueryResult(null);
    try {
      // Use credentials fetch (not adminFetch) so 401/502 never hangForever the probe UI.
      const res = await fetch("/api/admin/data-suite/query", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: queryRoleRef.current,
          dataset_id: "members",
          board_id: "sample_member_board",
        }),
      });
      let body: {
        code?: string;
        message?: string;
        reason?: string;
        data?: { rows?: Array<Record<string, string | null>>; masked?: boolean };
      } = {};
      try {
        body = (await res.json()) as typeof body;
      } catch {
        body = { message: "取数失败" };
      }
      setQueryResult({
        status: res.status,
        code: body.code,
        message: body.message,
        reason: body.reason,
        phone: body.data?.rows?.[0]?.phone ?? null,
        masked: body.data?.masked,
      });
    } catch (err) {
      setQueryResult({
        status: 0,
        message: err instanceof Error ? err.message : "取数失败",
      });
    } finally {
      setQueryBusy(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="data-security-page">
      <PageHeader title={t("title")} description={t("description")} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4" />
            {t("policyTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground" data-testid="data-security-policy-id">
            {t("policyId")}: {SAMPLE_MASKING_POLICY.id}
          </div>
          <div className="flex flex-wrap gap-2">
            {PREVIEW_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                data-testid={`data-security-role-${r}`}
                className={[
                  "rounded-md border px-3 py-1.5 text-sm",
                  role === r ? "border-primary bg-primary/10 text-primary" : "border-border",
                ].join(" ")}
                onClick={() => setRole(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <div>
              {t("rawPhone")}: <code>{SAMPLE_SECURITY_ROWS[0]?.phone ?? ""}</code>
            </div>
            <div data-testid="data-security-masked-phone">
              {t("maskedPhone")}: <code>{phone === null ? "null" : phone}</code>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("stubNote")}</p>
        </CardContent>
      </Card>

      <Card data-testid="data-query-acl-panel">
        <CardHeader>
          <CardTitle className="text-base">自助取数试探</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            选择数据角色后发起取数：越权返回 403，授权角色返回脱敏结果。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">数据角色</span>
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                data-testid={`data-query-role-${r}`}
                className={[
                  "rounded-md border px-3 py-1.5 text-sm",
                  queryRole === r ? "border-primary bg-primary/10 text-primary" : "border-border",
                ].join(" ")}
                onClick={() => {
                  queryRoleRef.current = r;
                  setQueryRole(r);
                }}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="text-sm text-muted-foreground">
            数据集: <code>members</code>
          </div>
          <button
            type="button"
            data-testid="data-query-run"
            disabled={queryBusy}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            onClick={() => void runQuery()}
          >
            发起取数
          </button>
          {queryResult ? (
            <div
              className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1"
              data-testid="data-query-result"
              data-status={String(queryResult.status)}
            >
              <div data-testid="data-query-result-label">
                {queryResult.status === 403
                  ? "数据权限不足（403）"
                  : queryResult.status === 200
                    ? "已脱敏返回"
                    : queryResult.message || "取数失败"}
              </div>
              <div data-testid="data-query-result-status">HTTP {queryResult.status}</div>
              {queryResult.reason ? (
                <div data-testid="data-query-result-reason">{queryResult.reason}</div>
              ) : null}
              {queryResult.status === 200 ? (
                <div data-testid="data-query-result-phone">
                  脱敏后: <code>{queryResult.phone === null ? "null" : queryResult.phone}</code>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
