"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@agenticx/ui";
import {
  Activity,
  Check,
  CircleDot,
  Eye,
  EyeOff,
  Plus,
  RefreshCcw,
  Trash2,
  Wrench,
  Server,
} from "lucide-react";

type ProviderRoute = "local" | "private-cloud" | "third-party";

interface ProviderModel {
  name: string;
  label: string;
  capabilities?: string[];
  enabled: boolean;
}

interface ProviderRecord {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKeyMasked: string;
  apiKeyConfigured: boolean;
  enabled: boolean;
  isDefault: boolean;
  route: ProviderRoute;
  envKey?: string;
  models: ProviderModel[];
  createdAt: string;
  updatedAt: string;
}

interface ProviderTemplate {
  id: string;
  displayName: string;
  baseUrl: string;
  envKey: string;
  route: ProviderRoute;
  popularModels: ProviderModel[];
}

type ListResp = {
  code: string;
  message: string;
  data?: { providers: ProviderRecord[]; templates: ProviderTemplate[] };
};

type ProviderResp = {
  code: string;
  message: string;
  data?: { provider: ProviderRecord };
};

type TestResp = {
  code: string;
  message: string;
  data?: { reachable?: boolean; via?: string; status?: number; preview?: string; modelCount?: number };
};

const ROUTE_LABEL: Record<ProviderRoute, string> = {
  local: "本地",
  "private-cloud": "私有云",
  "third-party": "第三方",
};

export default function ModelProvidersPage() {
  const [providers, setProviders] = useState<ProviderRecord[]>([]);
  const [templates, setTemplates] = useState<ProviderTemplate[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyDirty, setKeyDirty] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);
  const [testing, setTesting] = useState(false);
  const [addingModel, setAddingModel] = useState(false);
  const [newModel, setNewModel] = useState<{ name: string; label: string }>({ name: "", label: "" });

  const active = useMemo(() => providers.find((p) => p.id === activeId) ?? null, [providers, activeId]);

  const load = useCallback(async (preferId?: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/providers", { cache: "no-store" });
      const json = (await res.json()) as ListResp;
      if (!res.ok || !json.data) {
        toast.error(json.message ?? "加载失败");
        return;
      }
      setProviders(json.data.providers);
      setTemplates(json.data.templates);
      setActiveId((prev) => preferId ?? prev ?? json.data!.providers[0]?.id ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "网络错误");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 切换 provider 时重置 key 草稿
  useEffect(() => {
    setKeyDraft("");
    setKeyDirty(false);
    setKeyVisible(false);
  }, [activeId]);

  const persistProvider = useCallback(
    async (id: string, patch: Partial<ProviderRecord> & { apiKey?: string }) => {
      const res = await fetch(`/api/admin/providers/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = (await res.json()) as ProviderResp;
      if (!res.ok || !json.data) {
        toast.error(json.message ?? "保存失败");
        return null;
      }
      setProviders((prev) => prev.map((p) => (p.id === id ? json.data!.provider : p)));
      return json.data.provider;
    },
    []
  );

  const handleSaveKey = async () => {
    if (!active) return;
    const updated = await persistProvider(active.id, { apiKey: keyDraft });
    if (updated) {
      toast.success("已保存 API Key");
      setKeyDraft("");
      setKeyDirty(false);
    }
  };

  const handleToggleEnabled = async (next: boolean) => {
    if (!active) return;
    await persistProvider(active.id, { enabled: next });
  };

  const handleSetDefault = async (next: boolean) => {
    if (!active) return;
    await persistProvider(active.id, { isDefault: next });
  };

  const handleDeleteProvider = async () => {
    if (!active) return;
    if (!window.confirm(`确认删除厂商「${active.displayName}」？该操作不可撤销。`)) return;
    const res = await fetch(`/api/admin/providers/${active.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("删除失败");
      return;
    }
    toast.success("已删除");
    setActiveId(null);
    await load();
  };

  const handleTest = async () => {
    if (!active) return;
    setTesting(true);
    try {
      const res = await fetch(`/api/admin/providers/${active.id}/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(keyDraft.trim() ? { apiKey: keyDraft } : {}),
      });
      const json = (await res.json()) as TestResp;
      if (json.data?.reachable) {
        toast.success(`连通成功（${json.data.via ?? "OK"}${json.data.modelCount ? ` · ${json.data.modelCount} 个模型` : ""}）`);
      } else {
        toast.error(json.message ?? "连通失败");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "网络错误");
    } finally {
      setTesting(false);
    }
  };

  const handleAddModel = async () => {
    if (!active) return;
    if (!newModel.name.trim()) {
      toast.error("模型名不能为空");
      return;
    }
    const res = await fetch(`/api/admin/providers/${active.id}/models`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: newModel.name.trim(),
        label: newModel.label.trim() || newModel.name.trim(),
        enabled: true,
      }),
    });
    const json = (await res.json()) as ProviderResp;
    if (!res.ok || !json.data) {
      toast.error(json.message ?? "添加失败");
      return;
    }
    setProviders((prev) => prev.map((p) => (p.id === active.id ? json.data!.provider : p)));
    setNewModel({ name: "", label: "" });
    setAddingModel(false);
    toast.success("已添加");
  };

  const handleToggleModel = async (modelName: string, enabled: boolean) => {
    if (!active) return;
    const res = await fetch(
      `/api/admin/providers/${active.id}/models/${encodeURIComponent(modelName)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      }
    );
    const json = (await res.json()) as ProviderResp;
    if (!res.ok || !json.data) {
      toast.error(json.message ?? "更新失败");
      return;
    }
    setProviders((prev) => prev.map((p) => (p.id === active.id ? json.data!.provider : p)));
  };

  const handleDeleteModel = async (modelName: string) => {
    if (!active) return;
    if (!window.confirm(`从该厂商移除模型「${modelName}」？`)) return;
    const res = await fetch(
      `/api/admin/providers/${active.id}/models/${encodeURIComponent(modelName)}`,
      { method: "DELETE" }
    );
    const json = (await res.json()) as ProviderResp;
    if (!res.ok || !json.data) {
      toast.error(json.message ?? "删除失败");
      return;
    }
    setProviders((prev) => prev.map((p) => (p.id === active.id ? json.data!.provider : p)));
    toast.success("已移除");
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
              <BreadcrumbItem>平台配置</BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>模型服务</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="模型服务"
        description="管理上游大模型厂商、API Key 与可用模型；配置后将下发到 Gateway 与所有前台用户。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCcw />
              刷新
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus />
              添加厂商
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* 左：厂商列表 */}
        <Card>
          <CardContent className="p-2">
            {loading ? (
              <EmptyState
                icon={<Server className="h-5 w-5" />}
                title="加载中..."
                description="读取 admin providers"
                size="sm"
                className="border-0"
              />
            ) : providers.length === 0 ? (
              <EmptyState
                icon={<Server className="h-5 w-5" />}
                title="尚未配置厂商"
                description="点击右上「添加厂商」从模板选一个开始"
                size="sm"
                className="border-0"
              />
            ) : (
              <ul className="space-y-1">
                {providers.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(p.id)}
                      className={[
                        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                        activeId === p.id ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-muted",
                      ].join(" ")}
                    >
                      <CircleDot
                        className={[
                          "h-3 w-3 shrink-0",
                          p.enabled && p.apiKeyConfigured ? "text-success" : "text-destructive",
                        ].join(" ")}
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">{p.displayName}</span>
                      {p.isDefault ? (
                        <Badge variant="soft" className="ml-auto text-[10px]">默认</Badge>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* 右：详情 */}
        <Card>
          <CardContent className="space-y-5 p-5">
            {!active ? (
              <EmptyState
                icon={<Wrench className="h-5 w-5" />}
                title="未选择厂商"
                description="左侧选择一个厂商开始配置 API Key 与模型"
                size="sm"
                className="border-0"
              />
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{active.displayName}</h2>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="soft" className="font-mono text-[10px]">{active.id}</Badge>
                      <span>·</span>
                      <span>{ROUTE_LABEL[active.route]}</span>
                      {active.envKey ? (
                        <>
                          <span>·</span>
                          <span>未填 Key 时回退环境变量 <code className="font-mono">{active.envKey}</code></span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void handleDeleteProvider()}>
                    <Trash2 />
                    删除厂商
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <ToggleRow
                    label="已启用"
                    description="未启用时该厂商对前台不可见，gateway 也会跳过"
                    checked={active.enabled}
                    onChange={handleToggleEnabled}
                  />
                  <ToggleRow
                    label="设为默认"
                    description="新会话兜底使用该厂商首个启用模型"
                    checked={active.isDefault}
                    onChange={handleSetDefault}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>服务厂商显示名</Label>
                  <Input
                    value={active.displayName}
                    onChange={(event) =>
                      setProviders((prev) =>
                        prev.map((p) => (p.id === active.id ? { ...p, displayName: event.target.value } : p))
                      )
                    }
                    onBlur={(event) => {
                      const next = event.target.value.trim();
                      if (next && next !== active.displayName) {
                        void persistProvider(active.id, { displayName: next });
                      }
                    }}
                  />
                  <p className="text-xs text-muted-foreground">仅用于界面与侧栏展示；配置中的厂商 id 仍为左侧英文标识。</p>
                </div>

                <div className="space-y-1.5">
                  <Label>API 密钥</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type={keyVisible ? "text" : "password"}
                      placeholder={active.apiKeyConfigured ? active.apiKeyMasked : "粘贴 API Key（仅 admin 可见）"}
                      value={keyDraft}
                      onChange={(event) => {
                        setKeyDraft(event.target.value);
                        setKeyDirty(true);
                      }}
                    />
                    <Button variant="ghost" size="icon-sm" onClick={() => setKeyVisible((v) => !v)} aria-label="切换显示">
                      {keyVisible ? <EyeOff /> : <Eye />}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void handleTest()} disabled={testing}>
                      <Activity />
                      {testing ? "检测中..." : "检测"}
                    </Button>
                    <Button size="sm" onClick={() => void handleSaveKey()} disabled={!keyDirty}>
                      <Check />
                      保存
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Key 仅落到本机 <code className="font-mono">.runtime/admin/providers.json</code>（chmod 600），不会被前台用户读到。
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>API 地址</Label>
                  <Input
                    defaultValue={active.baseUrl}
                    onBlur={(event) => {
                      const next = event.target.value.trim();
                      if (next && next !== active.baseUrl) {
                        void persistProvider(active.id, { baseUrl: next });
                      }
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    预览：{active.baseUrl.replace(/\/$/, "")}/chat/completions
                  </p>
                </div>

                <div className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">模型列表（{active.models.length}）</h3>
                      <p className="text-xs text-muted-foreground">关闭某个模型后，前台将不会展示并禁止调用</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setAddingModel(true)}>
                      <Plus />
                      添加模型
                    </Button>
                  </div>

                  {active.models.length === 0 ? (
                    <EmptyState
                      icon={<Server className="h-5 w-5" />}
                      title="尚未添加模型"
                      description="点击右上「添加模型」"
                      size="sm"
                      className="border-0"
                    />
                  ) : (
                    <ul className="divide-y divide-border">
                      {active.models.map((m) => (
                        <li key={m.name} className="flex items-center gap-3 py-2.5">
                          <Checkbox
                            checked={m.enabled}
                            onCheckedChange={(value) => void handleToggleModel(m.name, value === true)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{m.label}</div>
                            <div className="truncate text-xs text-muted-foreground font-mono">{m.name}</div>
                          </div>
                          {m.capabilities?.map((cap) => (
                            <Badge key={cap} variant="soft" className="text-[10px]">{cap}</Badge>
                          ))}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => void handleDeleteModel(m.name)}
                            aria-label="移除模型"
                          >
                            <Trash2 />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <AddProviderDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        templates={templates}
        existingIds={providers.map((p) => p.id)}
        onCreated={(id) => void load(id)}
      />

      <Dialog open={addingModel} onOpenChange={setAddingModel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加模型</DialogTitle>
            <DialogDescription>{active?.displayName ?? ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="add-model-name">模型 ID</Label>
              <Input
                id="add-model-name"
                placeholder="例如 gpt-4o-mini / qwen-plus"
                value={newModel.name}
                onChange={(event) => setNewModel((prev) => ({ ...prev, name: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-model-label">显示名（可选）</Label>
              <Input
                id="add-model-label"
                placeholder="留空时使用 ID"
                value={newModel.label}
                onChange={(event) => setNewModel((prev) => ({ ...prev, label: event.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddingModel(false)}>取消</Button>
            <Button onClick={() => void handleAddModel()}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface-card px-3 py-2.5">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <span className="flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {description ? <span className="block text-xs text-muted-foreground">{description}</span> : null}
      </span>
      <Badge variant={checked ? "success" : "soft"} className="self-center text-[10px]">
        {checked ? "ON" : "OFF"}
      </Badge>
    </label>
  );
}

function AddProviderDialog({
  open,
  onOpenChange,
  templates,
  existingIds,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  templates: ProviderTemplate[];
  existingIds: string[];
  onCreated: (id: string) => void;
}) {
  const available = useMemo(
    () => templates.filter((t) => !existingIds.includes(t.id)),
    [templates, existingIds]
  );

  const [tab, setTab] = useState<"template" | "custom">("template");
  const [pickedTemplate, setPickedTemplate] = useState<string>("");
  const [custom, setCustom] = useState<{ id: string; displayName: string; baseUrl: string; route: ProviderRoute }>({
    id: "",
    displayName: "",
    baseUrl: "",
    route: "third-party",
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTab(available.length > 0 ? "template" : "custom");
      setPickedTemplate(available[0]?.id ?? "");
      setCustom({ id: "", displayName: "", baseUrl: "", route: "third-party" });
    }
  }, [open, available]);

  const submit = async () => {
    setSubmitting(true);
    try {
      let payload: Record<string, unknown>;
      if (tab === "template") {
        const tpl = available.find((t) => t.id === pickedTemplate);
        if (!tpl) {
          toast.error("请选择模板");
          return;
        }
        payload = {
          id: tpl.id,
          displayName: tpl.displayName,
          baseUrl: tpl.baseUrl,
          envKey: tpl.envKey,
          route: tpl.route,
        };
      } else {
        if (!custom.id.trim() || !custom.baseUrl.trim()) {
          toast.error("ID 与 baseUrl 必填");
          return;
        }
        payload = {
          id: custom.id.trim(),
          displayName: custom.displayName.trim() || custom.id.trim(),
          baseUrl: custom.baseUrl.trim(),
          route: custom.route,
        };
      }
      const res = await fetch("/api/admin/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as ProviderResp;
      if (!res.ok || !json.data) {
        toast.error(json.message ?? "添加失败");
        return;
      }
      toast.success(`已添加 ${json.data.provider.displayName}`);
      onCreated(json.data.provider.id);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>添加厂商</DialogTitle>
          <DialogDescription>从内置模板选择，或手动添加任意 OpenAI 兼容上游</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-1 rounded-md bg-muted p-1 text-sm">
            <button
              type="button"
              onClick={() => setTab("template")}
              className={[
                "flex-1 rounded px-3 py-1.5 transition-colors",
                tab === "template" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              ].join(" ")}
            >
              内置模板
            </button>
            <button
              type="button"
              onClick={() => setTab("custom")}
              className={[
                "flex-1 rounded px-3 py-1.5 transition-colors",
                tab === "custom" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              ].join(" ")}
            >
              手动添加
            </button>
          </div>

          {tab === "template" ? (
            available.length === 0 ? (
              <p className="text-sm text-muted-foreground">所有内置模板均已添加，请使用「手动添加」</p>
            ) : (
              <Select value={pickedTemplate} onValueChange={setPickedTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="选择模板..." />
                </SelectTrigger>
                <SelectContent>
                  {available.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.displayName}（{t.id}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          ) : (
            <div className="space-y-2">
              <div className="space-y-1.5">
                <Label>厂商 ID</Label>
                <Input
                  placeholder="例如 my-internal"
                  value={custom.id}
                  onChange={(event) => setCustom((prev) => ({ ...prev, id: event.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>显示名</Label>
                <Input
                  placeholder="留空使用 ID"
                  value={custom.displayName}
                  onChange={(event) => setCustom((prev) => ({ ...prev, displayName: event.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>API 地址（须 OpenAI 兼容，含 /v1）</Label>
                <Input
                  placeholder="https://api.example.com/v1"
                  value={custom.baseUrl}
                  onChange={(event) => setCustom((prev) => ({ ...prev, baseUrl: event.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>路由类型</Label>
                <Select
                  value={custom.route}
                  onValueChange={(value) => setCustom((prev) => ({ ...prev, route: value as ProviderRoute }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">本地</SelectItem>
                    <SelectItem value="private-cloud">私有云</SelectItem>
                    <SelectItem value="third-party">第三方</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            <Plus />
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
