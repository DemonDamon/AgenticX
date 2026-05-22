"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
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
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@agenticx/ui";
import { Plus, Save, Trash2 } from "lucide-react";

type QuotaAction = "block" | "warn" | "fallback";
type QuotaRule = {
  monthlyTokens: number;
  tpm?: number;
  rpm?: number;
  maxConcurrency?: number;
  action: QuotaAction;
};
type QuotaConfig = {
  defaults: { role: Record<string, QuotaRule>; model: Record<string, QuotaRule> };
  users: Record<string, QuotaRule>;
  departments: Record<string, QuotaRule>;
  apiTokens?: Record<string, QuotaRule>;
  updatedAt: string;
};

const EMPTY: QuotaConfig = {
  defaults: { role: {}, model: {} },
  users: {},
  departments: {},
  apiTokens: {},
  updatedAt: "",
};

const EMPTY_RULE: QuotaRule = { monthlyTokens: 0, tpm: 0, rpm: 0, maxConcurrency: 0, action: "warn" };

function RuleEditor({
  label,
  rule,
  onChange,
  onRemove,
}: {
  label: string;
  rule: QuotaRule;
  onChange: (patch: Partial<QuotaRule>) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="grid grid-cols-[160px_repeat(5,minmax(0,1fr))_auto] items-end gap-2 rounded-md border border-border px-3 py-3">
      <div className="font-medium text-sm pb-2">{label}</div>
      <div className="space-y-1">
        <Label className="text-xs">月 Token</Label>
        <Input type="number" value={rule.monthlyTokens} onChange={(e) => onChange({ monthlyTokens: Number(e.target.value || 0) })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">TPM</Label>
        <Input type="number" value={rule.tpm ?? 0} onChange={(e) => onChange({ tpm: Number(e.target.value || 0) })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">RPM</Label>
        <Input type="number" value={rule.rpm ?? 0} onChange={(e) => onChange({ rpm: Number(e.target.value || 0) })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">并发</Label>
        <Input type="number" value={rule.maxConcurrency ?? 0} onChange={(e) => onChange({ maxConcurrency: Number(e.target.value || 0) })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">策略</Label>
        <Select value={rule.action} onValueChange={(v) => onChange({ action: v as QuotaAction })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="warn">warn</SelectItem>
            <SelectItem value="block">block</SelectItem>
            <SelectItem value="fallback">fallback</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {onRemove ? (
        <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : (
        <div />
      )}
    </div>
  );
}

export default function MeteringQuotaPage() {
  const [quota, setQuota] = useState<QuotaConfig>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [newDept, setNewDept] = useState("");
  const [newUser, setNewUser] = useState("");
  const [newPat, setNewPat] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/metering/quota", { cache: "no-store" });
      const json = (await res.json()) as { data?: { quota?: QuotaConfig } };
      setQuota({ ...EMPTY, ...(json.data?.quota ?? EMPTY), apiTokens: json.data?.quota?.apiTokens ?? {} });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    const res = await fetch("/api/metering/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(quota),
    });
    if (!res.ok) {
      toast.error("保存失败");
      return;
    }
    toast.success("额度配置已保存");
    await load();
  };

  const updateMap = (scope: "users" | "departments" | "apiTokens", key: string, patch: Partial<QuotaRule>) => {
    setQuota((prev) => ({
      ...prev,
      [scope]: {
        ...(prev[scope] ?? {}),
        [key]: { ...(prev[scope]?.[key] ?? EMPTY_RULE), ...patch },
      },
    }));
  };

  const addMapKey = (scope: "users" | "departments" | "apiTokens", key: string) => {
    const trimmed = key.trim();
    if (!trimmed) return;
    setQuota((prev) => ({
      ...prev,
      [scope]: { ...(prev[scope] ?? {}), [trimmed]: prev[scope]?.[trimmed] ?? { ...EMPTY_RULE } },
    }));
  };

  const removeMapKey = (scope: "users" | "departments" | "apiTokens", key: string) => {
    setQuota((prev) => {
      const next = { ...(prev[scope] ?? {}) };
      delete next[key];
      return { ...prev, [scope]: next };
    });
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
                <BreadcrumbLink asChild>
                  <Link href="/metering">四维消耗</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>额度控制</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="Token 额度控制"
        description="租户 / 部门 / 用户 / API Token 四维度配额：monthly、TPM、RPM、并发。"
        actions={
          <Button size="sm" onClick={save} disabled={loading}>
            <Save className="h-4 w-4" />
            保存
          </Button>
        }
      />

      <Tabs defaultValue="roles">
        <TabsList>
          <TabsTrigger value="roles">角色默认</TabsTrigger>
          <TabsTrigger value="departments">部门</TabsTrigger>
          <TabsTrigger value="users">用户</TabsTrigger>
          <TabsTrigger value="pats">API Token</TabsTrigger>
        </TabsList>

        <TabsContent value="roles" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>角色默认额度</CardTitle>
              <CardDescription>未命中更细粒度规则时按角色回退。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(quota.defaults.role).map(([role, rule]) => (
                <RuleEditor key={role} label={role} rule={rule} onChange={(patch) =>
                  setQuota((prev) => ({
                    ...prev,
                    defaults: {
                      ...prev.defaults,
                      role: { ...prev.defaults.role, [role]: { ...rule, ...patch } },
                    },
                  }))
                } />
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="departments" className="mt-4 space-y-3">
          <div className="flex gap-2">
            <Input placeholder="部门 ID" value={newDept} onChange={(e) => setNewDept(e.target.value)} />
            <Button type="button" variant="outline" onClick={() => { addMapKey("departments", newDept); setNewDept(""); }}>
              <Plus className="h-4 w-4" /> 添加
            </Button>
          </div>
          {Object.entries(quota.departments).map(([id, rule]) => (
            <RuleEditor key={id} label={id} rule={rule} onChange={(patch) => updateMap("departments", id, patch)} onRemove={() => removeMapKey("departments", id)} />
          ))}
        </TabsContent>

        <TabsContent value="users" className="mt-4 space-y-3">
          <div className="flex gap-2">
            <Input placeholder="用户 ID" value={newUser} onChange={(e) => setNewUser(e.target.value)} />
            <Button type="button" variant="outline" onClick={() => { addMapKey("users", newUser); setNewUser(""); }}>
              <Plus className="h-4 w-4" /> 添加
            </Button>
          </div>
          {Object.entries(quota.users).map(([id, rule]) => (
            <RuleEditor key={id} label={id} rule={rule} onChange={(patch) => updateMap("users", id, patch)} onRemove={() => removeMapKey("users", id)} />
          ))}
        </TabsContent>

        <TabsContent value="pats" className="mt-4 space-y-3">
          <div className="flex gap-2">
            <Input placeholder="API Token ID（数字）" value={newPat} onChange={(e) => setNewPat(e.target.value)} />
            <Button type="button" variant="outline" onClick={() => { addMapKey("apiTokens", newPat); setNewPat(""); }}>
              <Plus className="h-4 w-4" /> 添加
            </Button>
          </div>
          {Object.entries(quota.apiTokens ?? {}).map(([id, rule]) => (
            <RuleEditor key={id} label={`PAT #${id}`} rule={rule} onChange={(patch) => updateMap("apiTokens", id, patch)} onRemove={() => removeMapKey("apiTokens", id)} />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
