"use client";

import { adminFetch } from "../../../lib/admin-client-auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
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
  toast,
  useLocale,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";

type GroupKey = "agent" | "user" | "dept" | "model" | "day";

type UsageRow = {
  dims: Record<string, string | null>;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_read_input_tokens: number;
  requests: number;
  sessions: number;
};

type Windows = { day: string; week: string; month: string };

type QuotaRule = {
  id: string;
  agent_id: string;
  subject: "default" | "user";
  user_id: string | null;
  daily_tokens: number;
  weekly_tokens: number;
  monthly_tokens: number;
  created_at: string;
  updated_at: string;
};

type UsageTotals = { day: number; week: number; month: number };

type AgentOption = { id: string; name: string };
type UserOption = { id: string; name: string };

type Draft = {
  key: string;
  id: string | null;
  subject: "default" | "user";
  userId: string | null;
  label: string;
  daily: string;
  weekly: string;
  monthly: string;
  used: UsageTotals | null;
  error: string;
};

const GROUPS: GroupKey[] = ["agent", "user", "dept", "model", "day"];

function isoDaysAgo(days: number): string {
  const date = new Date(Date.now() - days * 24 * 3600 * 1000);
  return date.toISOString().slice(0, 10);
}

function formatLocal(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function envelopeMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
    return body.message;
  }
  return fallback;
}

export default function AgentUsagePage() {
  const t = useTranslations("shell");
  const { isZh } = useLocale();
  const [tab, setTab] = useState("usage");
  const [start, setStart] = useState(() => isoDaysAgo(30));
  const [end, setEnd] = useState(() => isoDaysAgo(0));
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [groups, setGroups] = useState<GroupKey[]>(["agent"]);
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [windows, setWindows] = useState<Windows | null>(null);
  const [usageError, setUsageError] = useState("");
  const [loadingUsage, setLoadingUsage] = useState(false);

  const [quotaAgentId, setQuotaAgentId] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [quotaError, setQuotaError] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [userHits, setUserHits] = useState<UserOption[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Draft | null>(null);

  useEffect(() => {
    void adminFetch("/api/admin/agents", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { data?: { agents?: Array<{ id?: string; displayName?: string }> } };
        const options = (body.data?.agents ?? [])
          .filter((agent): agent is { id: string; displayName?: string } => typeof agent.id === "string")
          .map((agent) => ({ id: agent.id, name: agent.displayName || agent.id }));
        setAgents(options);
      })
      .catch(() => undefined);
  }, []);

  const loadUsage = useCallback(async () => {
    setLoadingUsage(true);
    setUsageError("");
    try {
      const response = await adminFetch("/api/metering/agents/usage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          start: new Date(`${start}T00:00:00`).toISOString(),
          end: new Date(`${end}T23:59:59`).toISOString(),
          agent_id: selectedAgents,
          group_by: groups,
        }),
      });
      const body = (await response.json()) as {
        message?: string;
        data?: { rows?: UsageRow[]; timezone?: string; windows?: Windows };
      };
      if (!response.ok) {
        setUsageError(envelopeMessage(body, isZh ? "查询失败" : "Query failed"));
        return;
      }
      setRows(body.data?.rows ?? []);
      if (body.data?.timezone) setTimezone(body.data.timezone);
      if (body.data?.windows) setWindows(body.data.windows);
    } catch (error) {
      setUsageError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingUsage(false);
    }
  }, [end, groups, isZh, selectedAgents, start]);

  const loadQuotas = useCallback(
    async (agentId: string) => {
      if (!agentId) {
        setDrafts([]);
        return;
      }
      setQuotaError("");
      const response = await adminFetch(`/api/metering/agents/quotas?agent_id=${encodeURIComponent(agentId)}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as {
        message?: string;
        data?: {
          rules?: QuotaRule[];
          usage?: Record<string, UsageTotals>;
          timezone?: string;
          windows?: Windows;
        };
      };
      if (!response.ok) {
        setQuotaError(envelopeMessage(body, isZh ? "读取配额失败" : "Failed to load quotas"));
        return;
      }
      if (body.data?.timezone) setTimezone(body.data.timezone);
      if (body.data?.windows) setWindows(body.data.windows);
      const rules = body.data?.rules ?? [];
      const usage = body.data?.usage ?? {};
      const fallback = rules.find((rule) => rule.subject === "default");
      const next: Draft[] = [
        {
          key: "default",
          id: fallback?.id ?? null,
          subject: "default",
          userId: null,
          label: isZh ? "所有用户（缺省）" : "All users (default)",
          daily: String(fallback?.daily_tokens ?? 0),
          weekly: String(fallback?.weekly_tokens ?? 0),
          monthly: String(fallback?.monthly_tokens ?? 0),
          used: null,
          error: "",
        },
      ];
      for (const rule of rules) {
        if (rule.subject !== "user" || !rule.user_id) continue;
        next.push({
          key: rule.id,
          id: rule.id,
          subject: "user",
          userId: rule.user_id,
          label: rule.user_id,
          daily: String(rule.daily_tokens),
          weekly: String(rule.weekly_tokens),
          monthly: String(rule.monthly_tokens),
          used: usage[rule.user_id] ?? { day: 0, week: 0, month: 0 },
          error: "",
        });
      }
      setDrafts(next);
    },
    [isZh],
  );

  useEffect(() => {
    if (tab === "usage") void loadUsage();
  }, [loadUsage, tab]);

  useEffect(() => {
    if (tab === "quota" && quotaAgentId) void loadQuotas(quotaAgentId);
  }, [loadQuotas, quotaAgentId, tab]);

  useEffect(() => {
    const query = userQuery.trim();
    if (!query) {
      setUserHits([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void adminFetch(`/api/admin/users?q=${encodeURIComponent(query)}&limit=20`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return;
          const body = (await response.json()) as {
            data?: { items?: Array<{ id?: string; displayName?: string; email?: string }> };
          };
          setUserHits(
            (body.data?.items ?? [])
              .filter((item): item is { id: string; displayName?: string; email?: string } => typeof item.id === "string")
              .map((item) => ({ id: item.id, name: item.displayName || item.email || item.id })),
          );
        })
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [userQuery]);

  const caption = useMemo(() => {
    const period = windows
      ? isZh
        ? `本日 ${formatLocal(windows.day, timezone)} 起，本周（周一）${formatLocal(windows.week, timezone)} 起，本月 ${formatLocal(windows.month, timezone)} 起`
        : `Day from ${formatLocal(windows.day, timezone)}, week (Monday) from ${formatLocal(windows.week, timezone)}, month from ${formatLocal(windows.month, timezone)}`
      : "";
    const lead = isZh
      ? `按 ${timezone} 统计，数据来自托管会话`
      : `Totals follow ${timezone}. Data comes from managed sessions`;
    return period ? `${lead}。${period}` : lead;
  }, [isZh, timezone, windows]);

  function toggleAgent(id: string) {
    setSelectedAgents((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function toggleGroup(key: GroupKey) {
    setGroups((current) => {
      if (current.includes(key)) {
        const next = current.filter((item) => item !== key);
        return next.length > 0 ? next : current;
      }
      if (current.length >= 3) return current;
      return [...current, key];
    });
  }

  function updateDraft(key: string, patch: Partial<Draft>) {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
  }

  async function saveDraft(draft: Draft) {
    if (!quotaAgentId) return;
    updateDraft(draft.key, { error: "" });
    const response = await adminFetch("/api/metering/agents/quotas", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: quotaAgentId,
        subject: draft.subject,
        user_id: draft.userId ?? undefined,
        daily_tokens: Number(draft.daily),
        weekly_tokens: Number(draft.weekly),
        monthly_tokens: Number(draft.monthly),
      }),
    });
    const body = (await response.json()) as { message?: string };
    if (!response.ok) {
      updateDraft(draft.key, { error: envelopeMessage(body, isZh ? "保存失败" : "Save failed") });
      return;
    }
    toast.success(isZh ? "配额已保存" : "Quota saved");
    await loadQuotas(quotaAgentId);
  }

  async function confirmDelete() {
    if (!pendingDelete?.id || !quotaAgentId) return;
    const response = await adminFetch(`/api/metering/agents/quotas/${pendingDelete.id}`, { method: "DELETE" });
    const body = (await response.json()) as { message?: string };
    if (!response.ok) {
      updateDraft(pendingDelete.key, { error: envelopeMessage(body, isZh ? "删除失败" : "Delete failed") });
      setPendingDelete(null);
      return;
    }
    setPendingDelete(null);
    toast.success(isZh ? "配额已删除" : "Quota deleted");
    await loadQuotas(quotaAgentId);
  }

  function addUser(user: UserOption) {
    if (drafts.some((draft) => draft.userId === user.id)) return;
    setDrafts((current) => [
      ...current,
      {
        key: `new:${user.id}`,
        id: null,
        subject: "user",
        userId: user.id,
        label: user.name,
        daily: "0",
        weekly: "0",
        monthly: "0",
        used: { day: 0, week: 0, month: 0 },
        error: "",
      },
    ]);
    setUserQuery("");
    setUserHits([]);
  }

  const dimLabels: Record<string, string> = isZh
    ? { agent: "智能体", agent_name: "名称", user: "用户", dept: "部门", model: "模型", day: "日" }
    : { agent: "Agent", agent_name: "Name", user: "User", dept: "Dept", model: "Model", day: "Day" };

  const visibleDims = groups.flatMap((key) => (key === "agent" ? ["agent", "agent_name"] : [key]));

  return (
    <div className="space-y-4 p-6">
      <PageHeader title={t("nav.items.agentUsage")} description={caption} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="usage">{isZh ? "用量" : "Usage"}</TabsTrigger>
          <TabsTrigger value="quota">{isZh ? "配额" : "Quotas"}</TabsTrigger>
        </TabsList>
        <TabsContent value="usage" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{isZh ? "筛选" : "Filters"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-3">
                <Label className="flex items-center gap-2">
                  {isZh ? "开始" : "Start"}
                  <Input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
                </Label>
                <Label className="flex items-center gap-2">
                  {isZh ? "结束" : "End"}
                  <Input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
                </Label>
              </div>
              <div className="flex flex-wrap gap-3">
                {GROUPS.map((key) => (
                  <label key={key} className="flex items-center gap-1 text-sm">
                    <input type="checkbox" checked={groups.includes(key)} onChange={() => toggleGroup(key)} />
                    {dimLabels[key]}
                  </label>
                ))}
              </div>
              <div className="flex max-h-32 flex-wrap gap-3 overflow-auto">
                {agents.map((agent) => (
                  <label key={agent.id} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedAgents.includes(agent.id)}
                      onChange={() => toggleAgent(agent.id)}
                    />
                    {agent.name}
                  </label>
                ))}
              </div>
              <Button type="button" onClick={() => void loadUsage()} disabled={loadingUsage}>
                {loadingUsage ? (isZh ? "查询中" : "Loading") : isZh ? "查询" : "Query"}
              </Button>
              {usageError ? <p className="text-sm text-destructive">{usageError}</p> : null}
            </CardContent>
          </Card>
          <div className="overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  {visibleDims.map((key) => (
                    <th key={key} className="px-3 py-2">
                      {dimLabels[key] ?? key}
                    </th>
                  ))}
                  <th className="px-3 py-2">{isZh ? "输入" : "Input"}</th>
                  <th className="px-3 py-2">{isZh ? "输出" : "Output"}</th>
                  <th className="px-3 py-2">{isZh ? "合计" : "Total"}</th>
                  <th className="px-3 py-2">{isZh ? "请求" : "Requests"}</th>
                  <th className="px-3 py-2">{isZh ? "会话" : "Sessions"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className="border-b">
                    {visibleDims.map((key) => (
                      <td key={key} className="px-3 py-2">
                        {row.dims[key] ?? ""}
                      </td>
                    ))}
                    <td className="px-3 py-2">{row.input_tokens}</td>
                    <td className="px-3 py-2">{row.output_tokens}</td>
                    <td className="px-3 py-2">{row.total_tokens}</td>
                    <td className="px-3 py-2">{row.requests}</td>
                    <td className="px-3 py-2">{row.sessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
        <TabsContent value="quota" className="space-y-4">
          <Label className="flex max-w-md flex-col gap-2">
            {isZh ? "智能体" : "Agent"}
            <select
              className="rounded-md border bg-background px-3 py-2"
              value={quotaAgentId}
              onChange={(event) => setQuotaAgentId(event.target.value)}
            >
              <option value="">{isZh ? "请选择" : "Select"}</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </Label>
          {quotaError ? <p className="text-sm text-destructive">{quotaError}</p> : null}
          {quotaAgentId ? (
            <div className="space-y-3">
              <div className="relative max-w-md">
                <Input
                  value={userQuery}
                  placeholder={isZh ? "搜索用户并添加覆盖" : "Search a user to add an override"}
                  onChange={(event) => setUserQuery(event.target.value)}
                />
                {userHits.length > 0 ? (
                  <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-popover">
                    {userHits.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                        onClick={() => addUser(user)}
                      >
                        {user.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {drafts.map((draft) => (
                <QuotaRowEditor
                  key={draft.key}
                  draft={draft}
                  isZh={isZh}
                  onChange={(patch) => updateDraft(draft.key, patch)}
                  onSave={() => void saveDraft(draft)}
                  onDelete={() => setPendingDelete(draft)}
                />
              ))}
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isZh ? "删除这条配额？" : "Delete this quota?"}</DialogTitle>
            <DialogDescription>
              {isZh ? "删除后该用户回到缺省规则。" : "The user falls back to the default rule."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingDelete(null)}>
              {isZh ? "取消" : "Cancel"}
            </Button>
            <Button type="button" onClick={() => void confirmDelete()}>
              {isZh ? "删除" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function limitHit(used: number | undefined, rawLimit: string): boolean {
  const limit = Number(rawLimit);
  return Number.isFinite(limit) && limit > 0 && (used ?? 0) >= limit;
}

function QuotaRowEditor({
  draft,
  isZh,
  onChange,
  onSave,
  onDelete,
}: {
  draft: Draft;
  isZh: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const usedClass = (used: number | undefined, rawLimit: string) =>
    limitHit(used, rawLimit) ? "text-destructive" : "text-muted-foreground";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{draft.label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-3">
          <NumberField label={isZh ? "日（0 = 不限）" : "Day (0 = none)"} value={draft.daily} onChange={(daily) => onChange({ daily })} />
          <NumberField label={isZh ? "周（0 = 不限）" : "Week (0 = none)"} value={draft.weekly} onChange={(weekly) => onChange({ weekly })} />
          <NumberField
            label={isZh ? "月（0 = 不限）" : "Month (0 = none)"}
            value={draft.monthly}
            onChange={(monthly) => onChange({ monthly })}
          />
        </div>
        {draft.used ? (
          <p className="text-sm">
            <span className={usedClass(draft.used.day, draft.daily)}>
              {isZh ? "本日" : "Day"} {draft.used.day}
            </span>
            {" · "}
            <span className={usedClass(draft.used.week, draft.weekly)}>
              {isZh ? "本周" : "Week"} {draft.used.week}
            </span>
            {" · "}
            <span className={usedClass(draft.used.month, draft.monthly)}>
              {isZh ? "本月" : "Month"} {draft.used.month}
            </span>
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="button" onClick={onSave}>
            {isZh ? "保存" : "Save"}
          </Button>
          {draft.subject === "user" && draft.id ? (
            <Button type="button" variant="outline" onClick={onDelete}>
              {isZh ? "删除" : "Delete"}
            </Button>
          ) : null}
        </div>
        {draft.error ? <p className="text-sm text-destructive">{draft.error}</p> : null}
      </CardContent>
    </Card>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Label className="flex flex-col gap-1 text-sm">
      {label}
      <Input value={value} inputMode="numeric" onChange={(event) => onChange(event.target.value)} />
    </Label>
  );
}
