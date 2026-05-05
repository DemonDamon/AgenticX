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
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "@agenticx/ui";
import { Pencil, Plus, RotateCcw, Send, ShieldCheck, ShieldX, TestTube2, Trash2 } from "lucide-react";

type PolicyAppliesTo = {
  departmentIds: string[];
  roleCodes: string[];
  userIds: string[];
  userExcludeIds: string[];
  clientTypes: string[];
  stages: string[];
};

type PolicyPack = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  enabled: boolean;
  source: "builtin" | "custom";
};

type PolicyRule = {
  id: string;
  packId: string;
  code: string;
  kind: "keyword" | "regex" | "pii";
  action: "block" | "redact" | "warn";
  severity: "low" | "medium" | "high" | "critical";
  message: string | null;
  payload: { keywords?: string[]; pattern?: string; piiType?: string };
  appliesTo: PolicyAppliesTo | null;
  status: "draft" | "active" | "disabled";
};

type PublishEvent = {
  id: string;
  version: number;
  publisher: string | null;
  publishedAt: string;
  status: "published" | "rolled_back";
};

type RuleForm = {
  id?: string;
  packId: string;
  code: string;
  kind: "keyword" | "regex" | "pii";
  action: "block" | "redact" | "warn";
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  payloadKeywords: string;
  payloadPattern: string;
  payloadPiiType: string;
  status: "draft" | "active" | "disabled";
  appliesDepartmentIds: string;
  appliesRoleCodes: string;
  appliesUserIds: string;
  appliesUserExcludeIds: string;
  appliesClientTypes: string;
  appliesStages: string;
};

function parseList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function summarizeAppliesTo(appliesTo: PolicyAppliesTo | null): string {
  if (!appliesTo) return "继承规则包";
  const chunks: string[] = [];
  if (appliesTo.departmentIds.length === 1 && appliesTo.departmentIds[0] === "*") chunks.push("全员");
  else if (appliesTo.departmentIds.length > 0) chunks.push(`${appliesTo.departmentIds.length}个部门`);
  if (!(appliesTo.roleCodes.length === 1 && appliesTo.roleCodes[0] === "*") && appliesTo.roleCodes.length > 0) {
    chunks.push(`${appliesTo.roleCodes.length}个角色`);
  }
  if (!(appliesTo.clientTypes.length === 1 && appliesTo.clientTypes[0] === "*") && appliesTo.clientTypes.length > 0) {
    chunks.push(appliesTo.clientTypes.join("/"));
  }
  return chunks.join(" · ") || "全员";
}

export default function PolicyPage() {
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("all");
  const [packs, setPacks] = useState<PolicyPack[]>([]);
  const [rules, setRules] = useState<PolicyRule[]>([]);
  const [publishes, setPublishes] = useState<PublishEvent[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sampleText, setSampleText] = useState("");
  const [testSummary, setTestSummary] = useState<string>("");
  const [syncStatus, setSyncStatus] = useState<"unknown" | "pending" | "synced">("unknown");
  const [form, setForm] = useState<RuleForm>({
    packId: "",
    code: "",
    kind: "keyword",
    action: "warn",
    severity: "medium",
    message: "",
    payloadKeywords: "",
    payloadPattern: "",
    payloadPiiType: "email",
    status: "draft",
    appliesDepartmentIds: "*",
    appliesRoleCodes: "*",
    appliesUserIds: "",
    appliesUserExcludeIds: "",
    appliesClientTypes: "*",
    appliesStages: "request,response",
  });

  const latestPublish = publishes[0] ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [packsRes, rulesRes, publishRes] = await Promise.all([
        fetch("/api/policy/packs", { cache: "no-store" }),
        fetch("/api/policy/rules", { cache: "no-store" }),
        fetch("/api/policy/publishes", { cache: "no-store" }),
      ]);
      const packsJson = (await packsRes.json()) as { message?: string; data?: { packs?: PolicyPack[] } };
      const rulesJson = (await rulesRes.json()) as { message?: string; data?: { rules?: PolicyRule[] } };
      const publishJson = (await publishRes.json()) as { message?: string; data?: { events?: PublishEvent[] } };
      if (!packsRes.ok) throw new Error(packsJson.message ?? "加载规则包失败");
      if (!rulesRes.ok) throw new Error(rulesJson.message ?? "加载规则失败");
      if (!publishRes.ok) throw new Error(publishJson.message ?? "加载发布记录失败");
      const nextPacks = packsJson.data?.packs ?? [];
      setPacks(nextPacks);
      setRules(rulesJson.data?.rules ?? []);
      setPublishes(publishJson.data?.events ?? []);
      setForm((prev) => ({ ...prev, packId: prev.packId || nextPacks[0]?.id || "" }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRules = useMemo(() => {
    if (tab === "all") return rules;
    if (tab === "keyword" || tab === "regex" || tab === "pii") return rules.filter((rule) => rule.kind === tab);
    return rules;
  }, [rules, tab]);

  const resetForm = () => {
    setForm({
      packId: packs[0]?.id ?? "",
      code: "",
      kind: "keyword",
      action: "warn",
      severity: "medium",
      message: "",
      payloadKeywords: "",
      payloadPattern: "",
      payloadPiiType: "email",
      status: "draft",
      appliesDepartmentIds: "*",
      appliesRoleCodes: "*",
      appliesUserIds: "",
      appliesUserExcludeIds: "",
      appliesClientTypes: "*",
      appliesStages: "request,response",
    });
    setSampleText("");
    setTestSummary("");
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (rule: PolicyRule) => {
    setForm({
      id: rule.id,
      packId: rule.packId,
      code: rule.code,
      kind: rule.kind,
      action: rule.action,
      severity: rule.severity,
      message: rule.message ?? "",
      payloadKeywords: (rule.payload.keywords ?? []).join("\n"),
      payloadPattern: rule.payload.pattern ?? "",
      payloadPiiType: rule.payload.piiType ?? "email",
      status: rule.status,
      appliesDepartmentIds: (rule.appliesTo?.departmentIds ?? ["*"]).join(","),
      appliesRoleCodes: (rule.appliesTo?.roleCodes ?? ["*"]).join(","),
      appliesUserIds: (rule.appliesTo?.userIds ?? []).join(","),
      appliesUserExcludeIds: (rule.appliesTo?.userExcludeIds ?? []).join(","),
      appliesClientTypes: (rule.appliesTo?.clientTypes ?? ["*"]).join(","),
      appliesStages: (rule.appliesTo?.stages ?? ["request", "response"]).join(","),
    });
    setSampleText("");
    setTestSummary("");
    setDialogOpen(true);
  };

  const saveRule = async (mode: "draft" | "publish") => {
    const payload =
      form.kind === "keyword"
        ? { keywords: parseList(form.payloadKeywords) }
        : form.kind === "regex"
          ? { pattern: form.payloadPattern.trim() }
          : { piiType: form.payloadPiiType.trim() };
    const body = {
      packId: form.packId,
      code: form.code.trim(),
      kind: form.kind,
      action: form.action,
      severity: form.severity,
      message: form.message.trim() || null,
      payload,
      status: mode === "draft" ? "draft" : "active",
      appliesTo: {
        departmentIds: parseList(form.appliesDepartmentIds || "*"),
        roleCodes: parseList(form.appliesRoleCodes || "*"),
        userIds: parseList(form.appliesUserIds),
        userExcludeIds: parseList(form.appliesUserExcludeIds),
        clientTypes: parseList(form.appliesClientTypes || "*"),
        stages: parseList(form.appliesStages || "request,response"),
      },
    };
    const url = form.id ? `/api/policy/rules/${form.id}` : "/api/policy/rules";
    const method = form.id ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? "保存失败");
      return;
    }
    if (mode === "publish") {
      await triggerPublish();
    } else {
      toast.success("草稿已保存");
    }
    setDialogOpen(false);
    await load();
  };

  const triggerPublish = async () => {
    const res = await fetch("/api/policy/publish", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? "发布失败");
      return;
    }
    toast.success("规则已发布，已对新请求生效");
    setSyncStatus("pending");
    for (let i = 0; i < 5; i += 1) {
      const health = await fetch("/healthz", { cache: "no-store" }).catch(() => null);
      if (health?.ok) {
        setSyncStatus("synced");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    setSyncStatus("unknown");
  };

  const deleteRule = async (id: string) => {
    const res = await fetch(`/api/policy/rules/${id}`, { method: "DELETE" });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? "删除失败");
      return;
    }
    toast.success("规则已删除");
    await load();
  };

  const runTest = async () => {
    if (!form.id) {
      toast.error("请先保存规则再测试");
      return;
    }
    const res = await fetch("/api/policy/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ruleIds: [form.id], sampleText, stage: "request" }),
    });
    const json = (await res.json()) as { message?: string; data?: { blocked?: boolean; hits?: unknown[] } };
    if (!res.ok || !json.data) {
      toast.error(json.message ?? "测试失败");
      return;
    }
    setTestSummary(`blocked=${Boolean(json.data.blocked)} · hits=${Array.isArray(json.data.hits) ? json.data.hits.length : 0}`);
  };

  const togglePack = async (pack: PolicyPack, enabled: boolean) => {
    const res = await fetch(`/api/policy/packs/${encodeURIComponent(pack.code)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? "更新失败");
      return;
    }
    toast.success(enabled ? `已启用 ${pack.name}` : `已禁用 ${pack.name}`);
    await load();
  };

  const rollback = async (id: string) => {
    const res = await fetch(`/api/policy/publishes/${encodeURIComponent(id)}/rollback`, { method: "POST" });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? "回滚失败");
      return;
    }
    toast.success("已回滚到该版本");
    await load();
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
              <BreadcrumbItem>
                <BreadcrumbPage>策略规则中心</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="策略规则中心"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新建规则
            </Button>
            <Button size="sm" onClick={() => void triggerPublish()}>
              <Send className="h-4 w-4" />
              发布并生效
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            当前生效状态
            <Badge variant="outline">v{latestPublish?.version ?? "-"}</Badge>
            <Badge variant={syncStatus === "synced" ? "success" : "secondary"}>
              {syncStatus === "synced" ? "Gateway 已同步" : syncStatus === "pending" ? "等待网关同步" : "同步状态未知"}
            </Badge>
          </CardTitle>
          <CardDescription>
            {latestPublish
              ? `最后发布：${new Date(latestPublish.publishedAt).toLocaleString()} · ${latestPublish.publisher ?? "未知发布人"}`
              : "尚未发布"}
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">全部</TabsTrigger>
          <TabsTrigger value="keyword">关键词</TabsTrigger>
          <TabsTrigger value="regex">正则</TabsTrigger>
          <TabsTrigger value="pii">PII</TabsTrigger>
          <TabsTrigger value="packs">规则包</TabsTrigger>
          <TabsTrigger value="publishes">发布记录</TabsTrigger>
        </TabsList>

        {["all", "keyword", "regex", "pii"].map((key) => (
          <TabsContent key={key} value={key} className="space-y-3 pt-3">
            {filteredRules.map((rule) => (
              <div key={rule.id} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{rule.code}</span>
                      <Badge variant="outline">{rule.kind.toUpperCase()}</Badge>
                      <Badge variant="secondary">{rule.action}</Badge>
                      <Badge variant={rule.status === "active" ? "success" : "outline"}>
                        {rule.status === "active" ? "已发布" : rule.status === "draft" ? "草稿" : "已停用"}
                      </Badge>
                    </div>
                    <p className="text-sm text-text-subtle">{rule.message || "无文案"}</p>
                    <p className="text-xs text-text-faint">适用范围：{summarizeAppliesTo(rule.appliesTo)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(rule)}>
                      <Pencil className="h-4 w-4" />
                      编辑
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void deleteRule(rule.id)}>
                      <Trash2 className="h-4 w-4" />
                      删除
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {filteredRules.length === 0 ? <p className="text-sm text-text-faint">{loading ? "加载中..." : "暂无规则"}</p> : null}
          </TabsContent>
        ))}

        <TabsContent value="packs" className="pt-3">
          <Card>
            <CardHeader>
              <CardTitle>规则包</CardTitle>
              <CardDescription>切换规则包启停状态。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {packs.map((pack) => (
                <div key={pack.id} className="flex items-center justify-between rounded-md border border-border px-3 py-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{pack.name}</span>
                      <Badge variant={pack.enabled ? "success" : "secondary"}>{pack.enabled ? "已启用" : "已禁用"}</Badge>
                      <Badge variant="outline">{pack.source === "builtin" ? "内置" : "自定义"}</Badge>
                    </div>
                    <p className="text-sm text-text-subtle">{pack.description || "无描述"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {pack.enabled ? <ShieldCheck className="h-4 w-4 text-green-600" /> : <ShieldX className="h-4 w-4 text-gray-500" />}
                    <Checkbox checked={pack.enabled} onCheckedChange={(next) => void togglePack(pack, next === true)} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="publishes" className="pt-3">
          <Card>
            <CardHeader>
              <CardTitle>发布记录</CardTitle>
              <CardDescription>支持快速回滚。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {publishes.map((event) => (
                <div key={event.id} className="flex items-center justify-between rounded-md border border-border px-3 py-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">v{event.version}</Badge>
                      <Badge variant={event.status === "published" ? "success" : "secondary"}>{event.status}</Badge>
                    </div>
                    <p className="text-sm text-text-subtle">
                      {new Date(event.publishedAt).toLocaleString()} · {event.publisher ?? "未知发布人"}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void rollback(event.id)}>
                    <RotateCcw className="h-4 w-4" />
                    回滚到此版本
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "编辑规则" : "新建规则"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>规则编码</Label>
              <Input value={form.code} onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>规则包</Label>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={form.packId}
                onChange={(e) => setForm((prev) => ({ ...prev, packId: e.target.value }))}
              >
                {packs.map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>类型</Label>
              <select className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.kind} onChange={(e) => setForm((prev) => ({ ...prev, kind: e.target.value as RuleForm["kind"] }))}>
                <option value="keyword">关键词</option>
                <option value="regex">正则</option>
                <option value="pii">PII</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>动作</Label>
              <select className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.action} onChange={(e) => setForm((prev) => ({ ...prev, action: e.target.value as RuleForm["action"] }))}>
                <option value="warn">warn</option>
                <option value="redact">redact</option>
                <option value="block">block</option>
              </select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label>文案</Label>
              <Input value={form.message} onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))} />
            </div>
            {form.kind === "keyword" ? (
              <div className="col-span-2 space-y-1">
                <Label>关键词（逗号/换行分隔）</Label>
                <Textarea value={form.payloadKeywords} onChange={(e) => setForm((prev) => ({ ...prev, payloadKeywords: e.target.value }))} />
              </div>
            ) : null}
            {form.kind === "regex" ? (
              <div className="col-span-2 space-y-1">
                <Label>Pattern</Label>
                <Input value={form.payloadPattern} onChange={(e) => setForm((prev) => ({ ...prev, payloadPattern: e.target.value }))} />
              </div>
            ) : null}
            {form.kind === "pii" ? (
              <div className="col-span-2 space-y-1">
                <Label>PII Type</Label>
                <Input value={form.payloadPiiType} onChange={(e) => setForm((prev) => ({ ...prev, payloadPiiType: e.target.value }))} />
              </div>
            ) : null}
            <div className="col-span-2 rounded-md border border-border p-3">
              <p className="mb-2 text-sm font-medium">适用范围</p>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="departmentIds: * 或 id1,id2" value={form.appliesDepartmentIds} onChange={(e) => setForm((prev) => ({ ...prev, appliesDepartmentIds: e.target.value }))} />
                <Input placeholder="roleCodes: * 或 sales,member" value={form.appliesRoleCodes} onChange={(e) => setForm((prev) => ({ ...prev, appliesRoleCodes: e.target.value }))} />
                <Input placeholder="userIds: u1,u2" value={form.appliesUserIds} onChange={(e) => setForm((prev) => ({ ...prev, appliesUserIds: e.target.value }))} />
                <Input placeholder="userExcludeIds: u3,u4" value={form.appliesUserExcludeIds} onChange={(e) => setForm((prev) => ({ ...prev, appliesUserExcludeIds: e.target.value }))} />
                <Input placeholder="clientTypes: * 或 web-portal,desktop" value={form.appliesClientTypes} onChange={(e) => setForm((prev) => ({ ...prev, appliesClientTypes: e.target.value }))} />
                <Input placeholder="stages: request,response" value={form.appliesStages} onChange={(e) => setForm((prev) => ({ ...prev, appliesStages: e.target.value }))} />
              </div>
            </div>
            <div className="col-span-2 rounded-md border border-border p-3">
              <p className="mb-2 text-sm font-medium">样本测试</p>
              <Textarea value={sampleText} onChange={(e) => setSampleText(e.target.value)} placeholder="输入测试文本" />
              <div className="mt-2 flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void runTest()}>
                  <TestTube2 className="h-4 w-4" />
                  运行测试
                </Button>
                {testSummary ? <Badge variant="outline">{testSummary}</Badge> : null}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button variant="outline" onClick={() => void saveRule("draft")}>
              保存草稿
            </Button>
            <Button onClick={() => void saveRule("publish")}>发布并立即生效</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
