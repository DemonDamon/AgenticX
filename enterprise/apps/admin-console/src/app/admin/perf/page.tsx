"use client";
import { adminFetch } from "../../../lib/admin-client-auth";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, PageHeader, toast } from "@agenticx/ui";
import { ExternalLink, Gauge } from "lucide-react";
import { useTranslations } from "next-intl";

type PerfConfig = {
  enabled?: boolean;
  url?: string;
  app_name?: string;
};

export default function AdminPerfPage() {
  const t = useTranslations("pages.admin.perf");
  const [cfg, setCfg] = useState<PerfConfig | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/perf");
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "load failed");
      setCfg(json.data ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.loadFailed"));
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
            <Gauge className="h-4 w-4" />
            Pyroscope
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!cfg ? (
            <p className="text-muted-foreground">{t("loading")}</p>
          ) : cfg.enabled && cfg.url ? (
            <>
              <p>
                {t("enabledDetected")}{" "}
                <code className="rounded bg-muted px-1">PYROSCOPE_URL</code>
                {t("appNameLabel")}
                <strong className="ml-1">{cfg.app_name ?? "agenticx-gateway"}</strong>
              </p>
              <Button asChild variant="outline">
                <a href={cfg.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {t("openPyroscope")}
                </a>
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground">
              {t("disabledHint")}{" "}
              <code className="rounded bg-muted px-1">PYROSCOPE_URL</code>
              {t("disabledHintOptional")}{" "}
              <code className="rounded bg-muted px-1">GATEWAY_PYROSCOPE=on</code>
              {t("disabledHintSuffix")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
