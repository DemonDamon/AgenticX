"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader, toast } from "@agenticx/ui";
import { AlertTriangle } from "lucide-react";

type ErrorRow = {
  fingerprint: string;
  status_code: number;
  error_type: string;
  message: string;
  channel_id?: string;
  count: number;
  first_seen: string;
  last_seen: string;
  request_ids?: string[];
};

export default function AdminErrorsPage() {
  const [items, setItems] = useState<ErrorRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/errors");
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "load failed");
      setItems(json.data?.errors ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载错误聚类失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader title="上游错误聚类" description="按错误指纹聚合 24h 内上游失败（new-api 风格）。" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4" />
            Top Errors
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无聚类记录</p>
          ) : (
            items.map((item) => (
              <div key={item.fingerprint} className="rounded-md border px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="destructive">HTTP {item.status_code}</Badge>
                  <Badge variant="outline">{item.error_type}</Badge>
                  <span className="text-sm font-medium">count={item.count}</span>
                  <span className="text-xs text-muted-foreground">fp={item.fingerprint}</span>
                </div>
                <p className="mt-2 text-sm">{item.message}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  last_seen={item.last_seen}
                  {item.channel_id ? ` · channel=${item.channel_id}` : ""}
                </p>
                {item.request_ids?.length ? (
                  <p className="mt-1 text-xs text-muted-foreground">requests: {item.request_ids.join(", ")}</p>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
