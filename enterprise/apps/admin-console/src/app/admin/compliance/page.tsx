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

type ComplianceConfig = {
  tenantId: string;
  dataResidency: string | null;
  crossBorderAction: "allow" | "block" | "require_approval";
  auditRetentionYears: number;
  appendOnly: boolean;
  updatedAt: string;
};

export default function CompliancePage() {
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
      if (!res.ok) throw new Error(payload.message ?? "save failed");
      toast.success("合规设置已保存");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="合规与数据驻留"
        description="配置租户数据域、跨境流动策略与审计日志留存（链式不可篡改 + 可导出归档）。"
      />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/dashboard">控制台</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>合规留存</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Card>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="dataResidency">数据驻留域（如 cn / us / eu）</Label>
            <Input
              id="dataResidency"
              value={dataResidency}
              onChange={(e) => setDataResidency(e.target.value)}
              placeholder="留空表示不强制驻留判定"
            />
          </div>
          <div className="space-y-2">
            <Label>跨境命中动作</Label>
            <Select value={crossBorderAction} onValueChange={(v) => setCrossBorderAction(v as ComplianceConfig["crossBorderAction"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="allow">放行并审计打标</SelectItem>
                <SelectItem value="require_approval">待审批（占位，记录后拒绝）</SelectItem>
                <SelectItem value="block">拦截</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="retention">审计留存年限（HIPAA 式，默认 6 年）</Label>
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
              仅追加（哈希链不可篡改）
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
        {config?.updatedAt ? (
          <span className="text-xs text-muted-foreground">上次更新：{config.updatedAt}</span>
        ) : null}
        <Link href="/audit" className="text-sm text-primary hover:underline">
          查看跨境审计 →
        </Link>
      </div>
    </div>
  );
}
