"use client";
import { adminFetch } from "../../../lib/admin-client-auth";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageHeader,
  toast,
} from "@agenticx/ui";
import { Package, RefreshCcw, Upload } from "lucide-react";
import { useTranslations } from "next-intl";

type PluginRow = {
  name: string;
  version?: string;
  runtime?: string;
  enabled?: boolean;
  priority?: number;
};

export default function AdminPluginsPage() {
  const t = useTranslations("pages.admin.plugins");
  const tc = useTranslations("common");
  const [plugins, setPlugins] = useState<PluginRow[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [uploadName, setUploadName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/plugins");
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "load failed");
      setPlugins(json.data?.plugins ?? []);
      setEnabled(Boolean(json.data?.enabled));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reloadPlugins() {
    try {
      const res = await adminFetch("/api/admin/plugins", { method: "PUT" });
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "reload failed");
      toast.success(t("toast.reloadSuccess"));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.reloadFailed"));
    }
  }

  async function uploadPlugin(form: HTMLFormElement) {
    try {
      const fd = new FormData(form);
      if (!uploadName.trim()) {
        toast.error(t("toast.nameRequired"));
        return;
      }
      fd.set("name", uploadName.trim());
      const res = await adminFetch("/api/admin/plugins", { method: "POST", body: fd });
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "upload failed");
      toast.success(t("toast.uploadSuccess"));
      setUploadName("");
      form.reset();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.uploadFailed"));
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button variant="outline" size="sm" onClick={() => void reloadPlugins()}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            {t("hotReload")}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" />
            {t("runningPlugins")}
            <Badge variant={enabled ? "default" : "secondary"}>
              {enabled ? tc("status.enabled") : tc("status.disabled")}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">{tc("states.loading")}</p>
          ) : plugins.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("emptyPlugins")}</p>
          ) : (
            plugins.map((p, idx) => (
              <div
                key={`${p.name ?? "plugin"}-${idx}`}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    runtime={p.runtime ?? "wasm"} · priority={p.priority ?? 0}
                  </div>
                </div>
                <Badge variant={p.enabled ? "default" : "secondary"}>
                  {p.enabled ? "ON" : "OFF"}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("uploadTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void uploadPlugin(e.currentTarget);
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="plugin-name">{t("pluginDirName")}</Label>
              <Input
                id="plugin-name"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="wasm-my-plugin"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manifest">manifest.yaml</Label>
              <Input id="manifest" name="manifest" type="file" accept=".yaml,.yml" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wasm">{t("wasmOptional")}</Label>
              <Input id="wasm" name="wasm" type="file" accept=".wasm" />
            </div>
            <Button type="submit">
              <Upload className="mr-2 h-4 w-4" />
              {t("uploadSubmit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
