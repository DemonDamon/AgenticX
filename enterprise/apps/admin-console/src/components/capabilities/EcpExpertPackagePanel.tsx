"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Switch,
  toast,
} from "@agenticx/ui";
import { Layers, RefreshCcw } from "lucide-react";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../lib/admin-client-auth";

type CatalogItem = {
  id: string;
  slug: string;
  displayName: string;
  resourceType: string;
  shelfStatus: string;
  version: string;
};

export function PlatformCatalogPanel() {
  const t = useTranslations("pages.admin.capabilityPacks.ecp");
  const tc = useTranslations("common");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/platform-catalog", { cache: "no-store" });
      const json = (await res.json()) as { data?: { items?: CatalogItem[] }; message?: string };
      if (!res.ok) throw new Error(json.message || tc("states.error"));
      setItems(json.data?.items ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("states.error"));
    } finally {
      setLoading(false);
    }
  }, [tc]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="size-4" /> {t("platformCatalog.title")}
        </CardTitle>
        <CardDescription>{t("platformCatalog.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCcw className="mr-1 size-4" /> {tc("actions.refresh")}
          </Button>
        </div>
        {loading && <p className="text-sm text-muted-foreground">{tc("states.loading")}</p>}
        {!loading &&
          items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <div>
                <div className="font-medium">{item.displayName || item.slug}</div>
                <div className="text-xs text-muted-foreground">
                  {item.slug} · {item.version}
                </div>
              </div>
              <div className="flex gap-2">
                <Badge variant="secondary">
                  {item.resourceType === "expert_package"
                    ? t("resourceType.expert_package")
                    : t("resourceType.skill")}
                </Badge>
                <Badge variant={item.shelfStatus === "published" ? "success" : "secondary"}>
                  {item.shelfStatus}
                </Badge>
              </div>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

export function EcpDistributionSettingsPanel() {
  const t = useTranslations("pages.admin.capabilityPacks.ecp");
  const tc = useTranslations("common");
  const [installCopyEnabled, setInstallCopyEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await adminFetch("/api/admin/ecp/distribution-settings");
        const json = (await res.json()) as {
          data?: { policy?: { installCopyEnabled?: boolean } };
          message?: string;
        };
        if (!res.ok) throw new Error(json.message || tc("states.error"));
        if (!cancelled) setInstallCopyEnabled(json.data?.policy?.installCopyEnabled === true);
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : tc("states.error"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tc]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("distribution.title")}</CardTitle>
        <CardDescription>{t("distribution.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="font-medium">{t("distribution.installCopyLabel")}</div>
          <p className="text-sm text-muted-foreground">{t("distribution.installCopyHint")}</p>
        </div>
        <Switch
          checked={installCopyEnabled}
          disabled={loading || saving}
          onCheckedChange={async (checked) => {
            setSaving(true);
            try {
              const res = await adminFetch("/api/admin/ecp/distribution-settings", {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ installCopyEnabled: checked }),
              });
              const json = (await res.json()) as { message?: string };
              if (!res.ok) throw new Error(json.message || tc("states.error"));
              setInstallCopyEnabled(checked);
              toast.success(t("distribution.saved"));
            } catch (error) {
              toast.error(error instanceof Error ? error.message : tc("states.error"));
            } finally {
              setSaving(false);
            }
          }}
        />
      </CardContent>
    </Card>
  );
}
