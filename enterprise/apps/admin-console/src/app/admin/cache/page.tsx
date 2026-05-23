"use client";
import { adminFetch } from "../../../lib/admin-client-auth";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageHeader,
  Switch,
  toast,
} from "@agenticx/ui";
import { Database, RefreshCcw, Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { GatewayCacheConfig } from "../../../lib/gateway-cache-store";

const DEFAULT: GatewayCacheConfig = {
  l1_enabled: true,
  l2_enabled: false,
  l1_ttl_minutes: 5,
  semantic_threshold: 0.92,
  replay_mode: "burst",
  model_allowlist: [],
  model_blocklist: [],
  l2_embedding_model: "",
};

export default function AdminCachePage() {
  const t = useTranslations("pages.admin.cache");
  const tc = useTranslations("common");
  const [config, setConfig] = useState<GatewayCacheConfig>(DEFAULT);
  const [allowlist, setAllowlist] = useState("");
  const [blocklist, setBlocklist] = useState("");
  const [evictPrefix, setEvictPrefix] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/cache");
      const json = (await res.json()) as { data?: GatewayCacheConfig };
      const data = json.data ?? DEFAULT;
      setConfig(data);
      setAllowlist(data.model_allowlist.join(","));
      setBlocklist(data.model_blocklist.join(","));
    } catch {
      toast.error(t("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const payload: GatewayCacheConfig = {
        ...config,
        model_allowlist: allowlist.split(",").map((s) => s.trim()).filter(Boolean),
        model_blocklist: blocklist.split(",").map((s) => s.trim()).filter(Boolean),
      };
      const res = await adminFetch("/api/admin/cache", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("toast.saveSuccess"));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc("toast.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function evict() {
    try {
      const res = await adminFetch("/api/admin/cache", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefix: evictPrefix }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("toast.evictSuccess"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toast.evictFailed"));
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            {tc("actions.refresh")}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            {t("policyTitle")}
          </CardTitle>
          <CardDescription>{t("policyDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label>{t("l1Label")}</Label>
              <p className="text-muted-foreground text-sm">{t("l1Hint")}</p>
            </div>
            <Switch checked={config.l1_enabled} onCheckedChange={(v) => setConfig((c) => ({ ...c, l1_enabled: v }))} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label>{t("l2Label")}</Label>
              <p className="text-muted-foreground text-sm">{t("l2Hint")}</p>
            </div>
            <Switch checked={config.l2_enabled} onCheckedChange={(v) => setConfig((c) => ({ ...c, l2_enabled: v }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="l1-ttl">{t("l1TtlLabel")}</Label>
            <Input
              id="l1-ttl"
              type="number"
              min={1}
              value={config.l1_ttl_minutes}
              onChange={(e) => setConfig((c) => ({ ...c, l1_ttl_minutes: Number(e.target.value) || 5 }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="semantic-threshold">{t("semanticThresholdLabel")}</Label>
            <Input
              id="semantic-threshold"
              type="number"
              step="0.01"
              min={0}
              max={1}
              value={config.semantic_threshold}
              onChange={(e) => setConfig((c) => ({ ...c, semantic_threshold: Number(e.target.value) || 0.92 }))}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="allowlist">{t("allowlistLabel")}</Label>
            <Input id="allowlist" value={allowlist} onChange={(e) => setAllowlist(e.target.value)} placeholder="gpt-4o,claude-3-5-sonnet-latest" />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="blocklist">{t("blocklistLabel")}</Label>
            <Input id="blocklist" value={blocklist} onChange={(e) => setBlocklist(e.target.value)} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="embedding-model">{t("embeddingModelLabel")}</Label>
            <Input
              id="embedding-model"
              value={config.l2_embedding_model}
              onChange={(e) => setConfig((c) => ({ ...c, l2_embedding_model: e.target.value }))}
              placeholder="text-embedding-3-small"
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={() => void save()} disabled={saving || loading}>
              <Save className="mr-2 h-4 w-4" />
              {tc("actions.save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("evictTitle")}</CardTitle>
          <CardDescription>{t("evictDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="evict-prefix">{t("keyPrefixLabel")}</Label>
            <Input id="evict-prefix" value={evictPrefix} onChange={(e) => setEvictPrefix(e.target.value)} placeholder={t("keyPrefixPlaceholder")} />
          </div>
          <Button variant="destructive" onClick={() => void evict()}>
            <Trash2 className="mr-2 h-4 w-4" />
            {tc("actions.evict")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
