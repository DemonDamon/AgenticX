"use client";
import { adminFetch } from "../../../lib/admin-client-auth";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader, toast } from "@agenticx/ui";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("pages.admin.errors");
  const [items, setItems] = useState<ErrorRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/errors");
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "load failed");
      setItems(json.data?.errors ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t("title")} description={t("description")} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4" />
            {t("cardTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
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
