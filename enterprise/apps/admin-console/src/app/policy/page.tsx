"use client";

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
  PageHeader,
  toast,
} from "@agenticx/ui";
import { RefreshCcw, ShieldCheck, ShieldX } from "lucide-react";

type PolicyPack = {
  name: string;
  version: string;
  description: string;
  source: string;
  enabled: boolean;
};

export default function PolicyPage() {
  const [loading, setLoading] = useState(false);
  const [packs, setPacks] = useState<PolicyPack[]>([]);
  const [overridePath, setOverridePath] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/policy/packs", { cache: "no-store" });
      const json = (await res.json()) as { data?: { packs?: PolicyPack[]; override_file?: string } };
      setPacks(json.data?.packs ?? []);
      setOverridePath(String(json.data?.override_file ?? ""));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const togglePack = async (name: string, enabled: boolean) => {
    const res = await fetch(`/api/policy/packs/${encodeURIComponent(name)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const json = (await res.json()) as { code?: string; message?: string; data?: { packs?: PolicyPack[] } };
    if (!res.ok) {
      toast.error(json.message ?? "更新失败");
      return;
    }
    setPacks(json.data?.packs ?? []);
    toast.success(enabled ? `已启用 ${name}` : `已禁用 ${name}`);
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
                <BreadcrumbPage>策略规则</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="策略规则包"
        description="基于 enterprise/plugins/moderation-* 的规则包启停控制。"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCcw className="h-4 w-4" />
            刷新
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>规则发布状态</CardTitle>
          <CardDescription>
            启停状态落盘到：<code>{overridePath || ".runtime/admin/policy-overrides.json"}</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {packs.map((pack) => (
            <div key={pack.name} className="flex items-center justify-between rounded-md border border-border px-3 py-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{pack.name}</span>
                  <Badge variant={pack.enabled ? "success" : "secondary"}>{pack.enabled ? "已启用" : "已禁用"}</Badge>
                  <Badge variant="outline">v{pack.version}</Badge>
                </div>
                <p className="text-sm text-text-subtle">{pack.description || "无描述"}</p>
                <p className="text-xs text-text-faint">{pack.source}</p>
              </div>
              <div className="flex items-center gap-2">
                {pack.enabled ? <ShieldCheck className="h-4 w-4 text-green-600" /> : <ShieldX className="h-4 w-4 text-gray-500" />}
                <Checkbox
                  checked={pack.enabled}
                  onCheckedChange={(next) => {
                    void togglePack(pack.name, next === true);
                  }}
                />
              </div>
            </div>
          ))}
          {packs.length === 0 ? <p className="text-sm text-text-faint">未发现 moderation 规则包。</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
