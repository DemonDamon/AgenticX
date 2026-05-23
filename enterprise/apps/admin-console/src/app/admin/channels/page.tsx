"use client";
import { adminFetch } from "../../../lib/admin-client-auth";

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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  toast,
} from "@agenticx/ui";
import { Activity, Circle, Pencil, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

interface ChannelRow {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  weight: number;
  priority: number;
  status: string;
  supportedModels: string[];
  apiKeyConfigured: boolean;
}

type HealthStat = {
  success_count?: number;
  failure_count?: number;
  success_rate?: number;
  p50_latency_ms?: number;
  last_error?: string;
  cooldown_until?: string | null;
};

type KeypoolStat = {
  key_ref: string;
  status: string;
  cooldown_until?: string;
  last_error?: string;
  consecutive_failures?: number;
};

type EditForm = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  keyRefs: string;
  weight: string;
  priority: string;
  models: string;
  status: "active" | "disabled";
  providerLabel: string;
  metadata: Record<string, unknown>;
};

export default function ChannelsPage() {
  const t = useTranslations("pages.admin.channels");
  const tc = useTranslations("common");
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [stats, setStats] = useState<Record<string, HealthStat>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EditForm | null>(null);
  const [keypoolStats, setKeypoolStats] = useState<KeypoolStat[]>([]);
  const [form, setForm] = useState({
    name: "",
    baseUrl: "",
    apiKey: "",
    weight: "1",
    models: "",
    providerLabel: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/channels/health");
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "load failed");
      setChannels(json.data.channels ?? []);
      setStats(json.data.stats ?? {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async () => {
    try {
      const models = form.models
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await adminFetch("/api/admin/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          baseUrl: form.baseUrl,
          apiKey: form.apiKey,
          weight: Number(form.weight) || 1,
          supportedModels: models,
          metadata: form.providerLabel ? { provider: form.providerLabel, route: "third-party" } : {},
        }),
      });
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "create failed");
      toast.success(t("toast.createSuccess"));
      setOpen(false);
      setForm({ name: "", baseUrl: "", apiKey: "", weight: "1", models: "", providerLabel: "" });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.createFailed"));
    }
  };

  const loadKeypoolStats = useCallback(async (channelId: string, keyRefs: string[]) => {
    if (!keyRefs.length) {
      setKeypoolStats([]);
      return;
    }
    const qs = new URLSearchParams({ key_refs: keyRefs.join(",") });
    const res = await fetch(`/api/admin/channels/${channelId}/keypool/stats?${qs}`);
    const json = await res.json();
    setKeypoolStats((json.data?.keys ?? []) as KeypoolStat[]);
  }, []);

  const openEdit = async (ch: ChannelRow) => {
    const res = await fetch(`/api/admin/channels/${ch.id}`);
    const json = await res.json();
    const detail = json.data?.channel as { metadata?: Record<string, unknown> } | undefined;
    const metadata = detail?.metadata && typeof detail.metadata === "object" ? detail.metadata : {};
    const rawRefs = metadata.keyRefs;
    const keyRefs = Array.isArray(rawRefs)
      ? rawRefs.filter((item): item is string => typeof item === "string").join(", ")
      : "";
    const providerLabel =
      typeof metadata.provider === "string"
        ? metadata.provider
        : ch.providerType ?? "";
    setEditing({
      id: ch.id,
      name: ch.name,
      baseUrl: ch.baseUrl,
      apiKey: "",
      keyRefs,
      weight: String(ch.weight ?? 1),
      priority: String(ch.priority ?? 0),
      models: (ch.supportedModels ?? []).join(", "),
      status: ch.status === "disabled" ? "disabled" : "active",
      providerLabel,
      metadata,
    });
    const refs = keyRefs
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    await loadKeypoolStats(ch.id, refs);
  };

  const onSaveEdit = async () => {
    if (!editing) return;
    try {
      const models = editing.models
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const body: Record<string, unknown> = {
        name: editing.name,
        baseUrl: editing.baseUrl,
        weight: Number(editing.weight) || 1,
        priority: Number(editing.priority) || 0,
        status: editing.status,
        supportedModels: models,
      };
      if (editing.apiKey.trim() !== "") body.apiKey = editing.apiKey;
      const keyRefList = editing.keyRefs
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const metadata: Record<string, unknown> = {
        ...editing.metadata,
        route: "third-party",
      };
      if (editing.providerLabel.trim() !== "") metadata.provider = editing.providerLabel.trim();
      if (keyRefList.length > 0) metadata.keyRefs = keyRefList;
      else delete metadata.keyRefs;
      body.metadata = metadata;
      const res = await fetch(`/api/admin/channels/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "update failed");
      toast.success(t("toast.updateSuccess"));
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.updateFailed"));
    }
  };

  const onProbe = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/channels/${id}/probe`, { method: "POST" });
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "probe failed");
      toast.success(t("toast.probeSuccess"));
      const models = (json.data?.probe?.supported_models as string[] | undefined) ?? [];
      if (editing?.id === id && models.length) {
        setEditing((prev) => (prev ? { ...prev, models: models.join(", ") } : prev));
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.probeFailed"));
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm(t("confirmDelete"))) return;
    const res = await fetch(`/api/admin/channels/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.code !== "00000") {
      toast.error(json.message || t("toast.deleteFailed"));
      return;
    }
    toast.success(t("toast.deleted"));
    await load();
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/">{t("breadcrumbHome")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{t("title")}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCcw className="mr-1 h-4 w-4" /> {tc("actions.refresh")}
            </Button>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> {t("newChannel")}
            </Button>
          </div>
        }
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : channels.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-5 w-5" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {channels.map((ch) => {
            const health = stats[ch.id];
            const rate = health?.success_rate != null ? `${Math.round(health.success_rate * 100)}%` : "—";
            return (
              <Card key={ch.id}>
                <CardContent className="space-y-3 pt-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{ch.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{ch.baseUrl}</p>
                    </div>
                    <Badge variant={ch.status === "active" ? "default" : "secondary"}>{ch.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>{t("weightPriority", { weight: ch.weight, priority: ch.priority })}</p>
                    <p>
                      {t("models")}
                      {ch.supportedModels.join(", ") || "—"}
                    </p>
                    <p>
                      Key：{ch.apiKeyConfigured ? t("keyConfigured") : t("keyNotConfigured")}
                    </p>
                    <p>
                      {t("successRate")}
                      {rate}
                      {typeof health?.p50_latency_ms === "number" && health.p50_latency_ms > 0
                        ? ` · p50 ${health.p50_latency_ms} ms`
                        : ""}
                    </p>
                    {health?.cooldown_until ? (
                      <p className="text-amber-600">
                        {t("cooldownUntil")} {health.cooldown_until}
                      </p>
                    ) : null}
                    {health?.last_error ? (
                      <p className="text-destructive truncate">
                        {t("lastError")}
                        {health.last_error}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(ch)}>
                      <Pencil className="mr-1 h-4 w-4" /> {t("edit")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void onProbe(ch.id)}>
                      <Circle className="mr-1 h-4 w-4" /> {t("probe")}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void onDelete(ch.id)}>
                      <Trash2 className="mr-1 h-4 w-4" /> {tc("actions.delete")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("nameLabel")}</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>{t("baseUrlLabel")}</Label>
              <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" />
            </div>
            <div>
              <Label>{t("apiKeyLabel")}</Label>
              <Input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
            </div>
            <div>
              <Label>{t("providerLabel")}</Label>
              <Input value={form.providerLabel} onChange={(e) => setForm({ ...form, providerLabel: e.target.value })} placeholder="deepseek" />
            </div>
            <div>
              <Label>{t("modelsLabel")}</Label>
              <Input value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })} placeholder="deepseek-chat" />
            </div>
            <div>
              <Label>{t("weightLabel")}</Label>
              <Input value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={() => void onCreate()}>{tc("actions.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editing != null} onOpenChange={(v) => (!v ? setEditing(null) : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editDialogTitle")}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <div className="space-y-3">
              <div>
                <Label>{t("nameLabel")}</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div>
                <Label>{t("baseUrlLabel")}</Label>
                <Input value={editing.baseUrl} onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} />
              </div>
              <div>
                <Label>{t("apiKeyLabel")}（{t("apiKeyKeepPlaceholder")}）</Label>
                <Input
                  type="password"
                  value={editing.apiKey}
                  onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
                  placeholder="******"
                />
              </div>
              <div>
                <Label>{t("keyRefsLabel")}</Label>
                <Input
                  value={editing.keyRefs}
                  onChange={(e) => setEditing({ ...editing, keyRefs: e.target.value })}
                  placeholder="DEEPSEEK_API_KEY_1, DEEPSEEK_API_KEY_2"
                />
                <p className="mt-1 text-xs text-muted-foreground">{t("keyRefsHint")}</p>
              </div>
              {keypoolStats.length > 0 ? (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <p className="text-xs font-medium">{t("keyPoolHealth")}</p>
                  {keypoolStats.map((stat) => (
                    <div key={stat.key_ref} className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <Circle
                          className={`h-2.5 w-2.5 fill-current ${
                            stat.status === "active"
                              ? "text-emerald-500"
                              : stat.status === "cooldown"
                                ? "text-amber-500"
                                : "text-destructive"
                          }`}
                        />
                        <code>{stat.key_ref}</code>
                        <span className="text-muted-foreground">{stat.status}</span>
                      </div>
                      {stat.status === "cooldown" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            await fetch(`/api/admin/channels/${editing.id}/keypool/stats`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ keyRef: stat.key_ref }),
                            });
                            const refs = editing.keyRefs
                              .split(/[\n,]/)
                              .map((s) => s.trim())
                              .filter(Boolean);
                            await loadKeypoolStats(editing.id, refs);
                            toast.success(t("toast.cooldownReset"));
                          }}
                        >
                          {t("resetCooldown")}
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              <div>
                <Label>{t("providerLabel")}</Label>
                <Input value={editing.providerLabel} onChange={(e) => setEditing({ ...editing, providerLabel: e.target.value })} />
              </div>
              <div>
                <Label>{t("modelsLabel")}</Label>
                <Input value={editing.models} onChange={(e) => setEditing({ ...editing, models: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>{t("weightLabel")}</Label>
                  <Input value={editing.weight} onChange={(e) => setEditing({ ...editing, weight: e.target.value })} />
                </div>
                <div>
                  <Label>{t("priorityLabel")}</Label>
                  <Input value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>{t("statusLabel")}</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={editing.status === "active" ? "default" : "outline"}
                    onClick={() => setEditing({ ...editing, status: "active" })}
                  >
                    {t("enable")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={editing.status === "disabled" ? "default" : "outline"}
                    onClick={() => setEditing({ ...editing, status: "disabled" })}
                  >
                    {t("disable")}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {tc("actions.cancel")}
            </Button>
            {editing ? (
              <Button variant="outline" onClick={() => void onProbe(editing.id)}>
                {t("probe")}
              </Button>
            ) : null}
            <Button onClick={() => void onSaveEdit()}>{tc("actions.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
