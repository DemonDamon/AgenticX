"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, PageHeader } from "@agenticx/ui";
import { useTranslations } from "next-intl";
import { Shield } from "lucide-react";
import {
  SAMPLE_MASKING_POLICY,
  SAMPLE_SECURITY_ROWS,
  maskRows,
} from "../../../lib/data-security-fixture";

const ROLES = ["admin", "analyst", "guest"] as const;

export default function DataSecuritySection() {
  const t = useTranslations("pages.admin.dataSecurity");
  const [role, setRole] = useState<(typeof ROLES)[number]>("analyst");
  const masked = useMemo(() => maskRows(SAMPLE_SECURITY_ROWS, role), [role]);
  const phone = masked[0]?.phone;

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
            {ROLES.map((r) => (
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
              {t("rawPhone")}: <code>{SAMPLE_SECURITY_ROWS[0].phone}</code>
            </div>
            <div data-testid="data-security-masked-phone">
              {t("maskedPhone")}: <code>{phone === null ? "null" : phone}</code>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("stubNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
