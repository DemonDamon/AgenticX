"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, PageHeader, toast } from "@agenticx/ui";
import { ExternalLink, Gauge } from "lucide-react";

type PerfConfig = {
  enabled?: boolean;
  url?: string;
  app_name?: string;
};

export default function AdminPerfPage() {
  const [cfg, setCfg] = useState<PerfConfig | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/perf");
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "load failed");
      setCfg(json.data ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载性能配置失败");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader title="持续 Profiling" description="可选接入 Grafana Pyroscope；本页仅展示跳转链接。" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4" />
            Pyroscope
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!cfg ? (
            <p className="text-muted-foreground">加载中…</p>
          ) : cfg.enabled && cfg.url ? (
            <>
              <p>
                已检测到 <code className="rounded bg-muted px-1">PYROSCOPE_URL</code>，应用名：
                <strong className="ml-1">{cfg.app_name ?? "agenticx-gateway"}</strong>
              </p>
              <Button asChild variant="outline">
                <a href={cfg.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  打开 Pyroscope
                </a>
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground">
              未启用。部署时在网关进程设置 <code className="rounded bg-muted px-1">PYROSCOPE_URL</code>（可选
              <code className="rounded bg-muted px-1">GATEWAY_PYROSCOPE=on</code>）。
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
