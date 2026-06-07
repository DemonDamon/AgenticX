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

const PROVIDER_TYPES = [
  "openai",
  "openai-compatible",
  "claude",
  "gemini",
  "azure",
  "bedrock",
] as const;

type ProviderType = (typeof PROVIDER_TYPES)[number];

function buildChannelMetadata(input: {
  providerLabel: string;
  providerType: ProviderType;
  deployment: string;
  apiVersion: string;
  accessKeyId: string;
  secretAccessKey: string;
  existing?: Record<string, unknown>;
}): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    ...(input.existing ?? {}),
    route: "third-party",
  };
  if (input.providerLabel.trim()) metadata.provider = input.providerLabel.trim();
  if (input.providerType === "azure") {
    if (input.deployment.trim()) metadata.deployment = input.deployment.trim();
    if (input.apiVersion.trim()) metadata.apiVersion = input.apiVersion.trim();
  }
  if (input.providerType === "bedrock") {
    if (input.accessKeyId.trim()) metadata.accessKeyId = input.accessKeyId.trim();
    if (input.secretAccessKey.trim()) metadata.secretAccessKey = input.secretAccessKey.trim();
  }
  return metadata;
}

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
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  keyRefs: string;
  weight: string;
  priority: string;
  models: string;
  status: "active" | "disabled";
  providerLabel: string;
  region: string;
  deployment: string;
  apiVersion: string;
  accessKeyId: string;
  secretAccessKey: string;
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
    providerType: "openai" as ProviderType,
    baseUrl: "",
    apiKey: "",
    weight: "1",
    models: "",
    providerLabel: "",
    region: "",
    deployment: "",
    apiVersion: "2024-02-01",
    accessKeyId: "",
    secretAccessKey: "",
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
      let baseUrl = form.baseUrl.trim();
      if (form.providerType === "bedrock" && !baseUrl) {
        const region = form.region.trim() || "us-east-1";
        baseUrl = `https://bedrock-runtime.${region}.amazonaws.com`;
      }
      if (!baseUrl) {
        toast.error(t("toast.createFailed"));
        return;
      }
      const res = await adminFetch("/api/admin/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          providerType: form.providerType,
          baseUrl,
          apiKey: form.apiKey,
          weight: Number(form.weight) || 1,
          supportedModels: models,
          region: form.region.trim() || undefined,
          metadata: buildChannelMetadata({
            providerLabel: form.providerLabel,
            providerType: form.providerType,
            deployment: form.deployment,
            apiVersion: form.apiVersion,
            accessKeyId: form.accessKeyId,
            secretAccessKey: form.secretAccessKey,
          }),
        }),
      });
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "create failed");
      toast.success(t("toast.createSuccess"));
      setOpen(false);
      setForm({
        name: "",
        providerType: "openai",
        baseUrl: "",
        apiKey: "",
        weight: "1",
        models: "",
        providerLabel: "",
        region: "",
        deployment: "",
        apiVersion: "2024-02-01",
        accessKeyId: "",
        secretAccessKey: "",
      });
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
    const detail = json.data?.channel as { metadata?: Record<string, unknown>; region?: string | null } | undefined;
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
      providerType: (PROVIDER_TYPES.includes(ch.providerType as ProviderType)
        ? ch.providerType
        : "openai") as ProviderType,
      baseUrl: ch.baseUrl,
      apiKey: "",
      keyRefs,
      weight: String(ch.weight ?? 1),
      priority: String(ch.priority ?? 0),
      models: (ch.supportedModels ?? []).join(", "),
      status: ch.status === "disabled" ? "disabled" : "active",
      providerLabel,
      region: detail?.region ?? "",
      deployment: typeof metadata.deployment === "string" ? metadata.deployment : "",
      apiVersion: typeof metadata.apiVersion === "string" ? metadata.apiVersion : "2024-02-01",
      accessKeyId: typeof metadata.accessKeyId === "string" ? metadata.accessKeyId : "",
      secretAccessKey: "",
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
        providerType: editing.providerType,
        baseUrl: editing.baseUrl,
        weight: Number(editing.weight) || 1,
        priority: Number(editing.priority) || 0,
        status: editing.status,
        supportedModels: models,
        region: editing.region.trim() || null,
      };
      if (editing.apiKey.trim() !== "") body.apiKey = editing.apiKey;
      const keyRefList = editing.keyRefs
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const metadata = buildChannelMetadata({
        providerLabel: editing.providerLabel,
        providerType: editing.providerType,
        deployment: editing.deployment,
        apiVersion: editing.apiVersion,
        accessKeyId: editing.accessKeyId,
        secretAccessKey: editing.secretAccessKey,
        existing: editing.metadata,
      });
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
              <Label>Provider Type</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={form.providerType}
                onChange={(e) => setForm({ ...form, providerType: e.target.value as ProviderType })}
              >
                {PROVIDER_TYPES.map((pt) => (
                  <option key={pt} value={pt}>
                    {pt}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>{t("baseUrlLabel")}</Label>
              <Input
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder={
                  form.providerType === "azure"
                    ? "https://{resource}.openai.azure.com"
                    : form.providerType === "bedrock"
                      ? "https://bedrock-runtime.{region}.amazonaws.com（可选，网关自动拼接）"
                      : "https://api.example.com/v1"
                }
              />
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
              <Label>Region（cn / us / eu）</Label>
              <Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="us-east-1" />
            </div>
            {form.providerType === "azure" ? (
              <>
                <div>
                  <Label>Deployment</Label>
                  <Input
                    value={form.deployment}
                    onChange={(e) => setForm({ ...form, deployment: e.target.value })}
                    placeholder="gpt-4o"
                  />
                </div>
                <div>
                  <Label>API Version</Label>
                  <Input
                    value={form.apiVersion}
                    onChange={(e) => setForm({ ...form, apiVersion: e.target.value })}
                    placeholder="2024-02-01"
                  />
                </div>
              </>
            ) : null}
            {form.providerType === "bedrock" ? (
              <>
                <div>
                  <Label>Access Key ID</Label>
                  <Input
                    value={form.accessKeyId}
                    onChange={(e) => setForm({ ...form, accessKeyId: e.target.value })}
                    placeholder="AKIA..."
                  />
                </div>
                <div>
                  <Label>Secret Access Key</Label>
                  <Input
                    type="password"
                    value={form.secretAccessKey}
                    onChange={(e) => setForm({ ...form, secretAccessKey: e.target.value })}
                  />
                </div>
                <p className="text-xs text-muted-foreground">或在 API Key 中填写 accessKeyId:secretAccessKey</p>
              </>
            ) : null}
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
                <Label>Provider Type</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={editing.providerType}
                  onChange={(e) => setEditing({ ...editing, providerType: e.target.value as ProviderType })}
                >
                  {PROVIDER_TYPES.map((pt) => (
                    <option key={pt} value={pt}>
                      {pt}
                    </option>
                  ))}
                </select>
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
                <Label>Region（cn / us / eu）</Label>
                <Input value={editing.region} onChange={(e) => setEditing({ ...editing, region: e.target.value })} placeholder="us-east-1" />
              </div>
              {editing.providerType === "azure" ? (
                <>
                  <div>
                    <Label>Deployment</Label>
                    <Input
                      value={editing.deployment}
                      onChange={(e) => setEditing({ ...editing, deployment: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>API Version</Label>
                    <Input
                      value={editing.apiVersion}
                      onChange={(e) => setEditing({ ...editing, apiVersion: e.target.value })}
                    />
                  </div>
                </>
              ) : null}
              {editing.providerType === "bedrock" ? (
                <>
                  <div>
                    <Label>Access Key ID</Label>
                    <Input
                      value={editing.accessKeyId}
                      onChange={(e) => setEditing({ ...editing, accessKeyId: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Secret Access Key（留空则不修改）</Label>
                    <Input
                      type="password"
                      value={editing.secretAccessKey}
                      onChange={(e) => setEditing({ ...editing, secretAccessKey: e.target.value })}
                      placeholder="******"
                    />
                  </div>
                </>
              ) : null}
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
