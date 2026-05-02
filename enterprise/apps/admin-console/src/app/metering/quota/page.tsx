"use client";

import { useEffect, useState } from "react";
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
import { Save } from "lucide-react";

type QuotaAction = "block" | "warn" | "fallback";
type QuotaRule = { monthlyTokens: number; action: QuotaAction };
type QuotaConfig = {
  defaults: {
    role: Record<string, QuotaRule>;
    model: Record<string, QuotaRule>;
  };
  users: Record<string, QuotaRule>;
  departments: Record<string, QuotaRule>;
  updatedAt: string;
};

const EMPTY: QuotaConfig = {
  defaults: { role: {}, model: {} },
  users: {},
  departments: {},
  updatedAt: "",
};

const EMPTY_RULE: QuotaRule = {
  monthlyTokens: 0,
  action: "warn",
};

export default function MeteringQuotaPage() {
  const [quota, setQuota] = useState<QuotaConfig>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [filePath, setFilePath] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/metering/quota", { cache: "no-store" });
      const json = (await res.json()) as { data?: { quota?: QuotaConfig; file?: string } };
      setQuota(json.data?.quota ?? EMPTY);
      setFilePath(String(json.data?.file ?? ""));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const updateRoleQuota = (role: string, patch: Partial<QuotaRule>) => {
    setQuota((prev) => ({
      ...prev,
      defaults: {
        ...prev.defaults,
        role: {
          ...prev.defaults.role,
          [role]: {
            ...(prev.defaults.role[role] ?? EMPTY_RULE),
            ...patch,
          },
        },
      },
    }));
  };

  const save = async () => {
    const res = await fetch("/api/metering/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(quota),
    });
    if (!res.ok) {
      toast.error("保存失败");
      return;
    }
    toast.success("额度配置已保存");
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
                <BreadcrumbLink asChild>
                  <Link href="/metering">四维消耗</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>额度控制</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="Token 额度控制"
        description="按角色默认额度管理，支持告警/阻断/降级策略。"
        actions={
          <Button size="sm" onClick={save} disabled={loading}>
            <Save className="h-4 w-4" />
            保存
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>角色默认额度</CardTitle>
          <CardDescription>配置文件：<code>{filePath || ".runtime/admin/quotas.json"}</code></CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.entries(quota.defaults.role).map(([role, rule]) => (
            <div key={role} className="grid grid-cols-[180px_1fr_220px] items-center gap-3 rounded-md border border-border px-3 py-3">
              <div className="font-medium">{role}</div>
              <div className="space-y-1">
                <Label>月度 Token 上限</Label>
                <Input
                  type="number"
                  value={rule.monthlyTokens}
                  onChange={(e) => updateRoleQuota(role, { monthlyTokens: Number(e.target.value || 0) })}
                />
              </div>
              <div className="space-y-1">
                <Label>超额策略</Label>
                <Select value={rule.action} onValueChange={(v) => updateRoleQuota(role, { action: v as QuotaAction })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warn">warn</SelectItem>
                    <SelectItem value="block">block</SelectItem>
                    <SelectItem value="fallback">fallback</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
