"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from "@agenticx/ui";
import { Ban, CheckCircle2, Plus, ShieldAlert } from "lucide-react";
import { adminFetch } from "../../lib/admin-client-auth";

type IncidentStatus = "open" | "handling" | "resolved";
type IncidentSeverity = "critical" | "high" | "medium" | "low";

type SecurityIncident = {
  id: string;
  title: string;
  source: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  traceId: string | null;
  sessionId: string | null;
  userId: string | null;
  model: string | null;
  summary: string | null;
  handledAt: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
};

type IncidentAction = {
  id: string;
  incidentId: string;
  actionType: "terminate_session" | "revoke_pat" | "disable_user" | "block_model";
  targetType: string;
  targetId: string | null;
  actorUserId: string | null;
  detail: Record<string, unknown> | null;
  outcome: "done" | "failed";
  createdAt: string;
};

const STATUS_LABEL: Record<IncidentStatus, string> = {
  open: "待处置",
  handling: "处置中",
  resolved: "已解决",
};

const ACTION_LABEL: Record<IncidentAction["actionType"], string> = {
  terminate_session: "终止会话",
  revoke_pat: "吊销 PAT",
  disable_user: "禁用用户",
  block_model: "拉黑模型",
};

const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  critical: "紧急",
  high: "高",
  medium: "中",
  low: "低",
};

export function SecurityIncidentsCard() {
  const [incidents, setIncidents] = useState<SecurityIncident[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<SecurityIncident | null>(null);
  const [actions, setActions] = useState<IncidentAction[]>([]);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [disposition, setDisposition] = useState<string>("open");
  const [busy, setBusy] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    action: "disable_user";
    targetId: string;
    email: string;
  } | null>(null);
  const [resolveNote, setResolveNote] = useState("");

  // 立案表单
  const [form, setForm] = useState({
    title: "",
    severity: "high" as IncidentSeverity,
    source: "manual",
    traceId: "",
    sessionId: "",
    userId: "",
    model: "",
    summary: "",
  });

  // 处置目标（从告警/事件上下文预填）
  const [target, setTarget] = useState({
    terminate_session: "",
    revoke_pat: "",
    disable_user: "",
    block_model: "",
  });

  const loadList = useCallback(async (status?: string) => {
    try {
      const query = status && status !== "all" ? `?status=${status}` : "";
      const res = await adminFetch(`/api/admin/security/incidents${query}`);
      const json = (await res.json()) as { data: SecurityIncident[] };
      setIncidents(json.data ?? []);
    } catch {
      toast.error("加载安全事件失败");
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await adminFetch(`/api/admin/security/incidents/${id}`);
      const json = (await res.json()) as { data: { incident: SecurityIncident; actions: IncidentAction[] } | null };
      if (!json.data) return;
      setSelected(json.data.incident);
      setActions(json.data.actions ?? []);
      const next = { terminate_session: "", revoke_pat: "", disable_user: "", block_model: "" };
      if (json.data.incident.sessionId) next.terminate_session = json.data.incident.sessionId;
      if (json.data.incident.userId) next.disable_user = json.data.incident.userId;
      if (json.data.incident.model) next.block_model = json.data.incident.model;
      setTarget(next);
    } catch {
      toast.error("加载事件详情失败");
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const createIncident = async () => {
    if (!form.title.trim()) {
      toast.error("标题必填");
      return;
    }
    setBusy(true);
    try {
      const res = await adminFetch("/api/admin/security/incidents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          traceId: form.traceId || undefined,
          sessionId: form.sessionId || undefined,
          userId: form.userId || undefined,
          model: form.model || undefined,
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { message?: string };
        toast.error(`立案失败：${json.message ?? res.status}`);
        return;
      }
      toast.success("事件已立案（open）");
      setShowCreate(false);
      setForm({ title: "", severity: "high", source: "manual", traceId: "", sessionId: "", userId: "", model: "", summary: "" });
      await loadList(disposition);
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (
    action: IncidentAction["actionType"],
    targetId: string,
    extra?: Record<string, unknown>,
  ) => {
    if (!selectedId || !targetId.trim()) {
      toast.error("请填写处置目标");
      return;
    }
    setBusy(true);
    try {
      const res = await adminFetch(`/api/admin/security/incidents/${selectedId}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, targetId: targetId.trim(), ...extra }),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        toast.error(`处置失败：${json.message ?? res.status}`);
        return;
      }
      toast.success(`${ACTION_LABEL[action]} 已执行（审计链留痕）`);
      setConfirmDialog(null);
      await loadDetail(selectedId);
      await loadList(disposition);
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (status: IncidentStatus, resolutionNote?: string) => {
    if (!selectedId) return;
    if (status === "resolved" && !resolutionNote?.trim()) {
      toast.error("结案必须填写说明");
      return;
    }
    setBusy(true);
    try {
      const res = await adminFetch(`/api/admin/security/incidents/${selectedId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, resolutionNote }),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        toast.error(`流转失败：${json.message ?? res.status}`);
        return;
      }
      toast.success(`事件状态已流转为 ${STATUS_LABEL[status]}`);
      setResolveNote("");
      await loadDetail(selectedId);
      await loadList(disposition);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" />
          <span className="text-sm font-medium">安全事件处置</span>
          <Badge variant="secondary">open → handling → resolved</Badge>
        </div>
        <p className="text-muted-foreground text-xs">
          从告警/审计一键立案（trace_id 关联审计链），处置动作先审计后执行：终止会话 / 吊销 PAT / 禁用用户 / 拉黑模型；用户级动作需二次确认。网关即时吊销原凭据 401。
        </p>

        <div className="flex items-center gap-2">
          <Select value={disposition} onValueChange={(v) => { setDisposition(v); void loadList(v === "all" ? undefined : v); }}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="open">待处置</SelectItem>
              <SelectItem value="handling">处置中</SelectItem>
              <SelectItem value="resolved">已解决</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => setShowCreate(!showCreate)}>
            <Plus className="mr-1 h-3 w-3" /> 立案
          </Button>
        </div>

        {showCreate && (
          <div className="grid gap-3 rounded-md border p-3 md:grid-cols-3">
            <div className="space-y-1 md:col-span-3">
              <Label>事件标题</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如：PII 外泄攻击-租户A" />
            </div>
            <div className="space-y-1">
              <Label>严重级别</Label>
              <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v as IncidentSeverity })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">紧急</SelectItem>
                  <SelectItem value="high">高</SelectItem>
                  <SelectItem value="medium">中</SelectItem>
                  <SelectItem value="low">低</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>来源</Label>
              <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">manual</SelectItem>
                  <SelectItem value="policy_hit">policy_hit</SelectItem>
                  <SelectItem value="budget_alert">budget_alert</SelectItem>
                  <SelectItem value="chain_check">chain_check</SelectItem>
                  <SelectItem value="moderation">moderation</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>trace_id（关联审计链）</Label>
              <Input value={form.traceId} onChange={(e) => setForm({ ...form, traceId: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>会话 ID</Label>
              <Input value={form.sessionId} onChange={(e) => setForm({ ...form, sessionId: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>用户 ID</Label>
              <Input value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>模型</Label>
              <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </div>
            <div className="space-y-1 md:col-span-3">
              <Label>事件摘要</Label>
              <Textarea value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} rows={2} />
            </div>
            <div className="md:col-span-3">
              <Button size="sm" disabled={busy} onClick={createIncident}>立案（open）</Button>
            </div>
          </div>
        )}

        <div className="max-h-64 space-y-1 overflow-auto">
          {incidents.length === 0 && (
            <p className="text-muted-foreground py-4 text-center text-xs">暂无安全事件记录</p>
          )}
          {incidents.map((incident) => (
            <button
              key={incident.id}
              className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-xs hover:bg-muted/50 ${selectedId === incident.id ? "border-primary bg-muted/60" : ""}`}
              onClick={() => setSelectedId(incident.id)}
            >
              <Badge variant={incident.status === "open" ? "destructive" : incident.status === "handling" ? "default" : "secondary"}>
                {STATUS_LABEL[incident.status]}
              </Badge>
              <Badge variant="outline">{SEVERITY_LABEL[incident.severity]}</Badge>
              <span className="flex-1 truncate font-medium">{incident.title}</span>
              {incident.traceId && <span className="text-muted-foreground shrink-0">trace: {incident.traceId.slice(0, 12)}</span>}
              <span className="text-muted-foreground shrink-0">{new Date(incident.createdAt).toLocaleString()}</span>
            </button>
          ))}
        </div>

        {selected && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium">{selected.title}</span>
              <Badge variant="outline">{selected.source}</Badge>
              <Badge variant="outline">{SEVERITY_LABEL[selected.severity]}</Badge>
              <Badge variant={selected.status === "open" ? "destructive" : selected.status === "handling" ? "default" : "secondary"}>
                {STATUS_LABEL[selected.status]}
              </Badge>
            </div>
            {selected.summary && <p className="text-muted-foreground text-xs">{selected.summary}</p>}
            {selected.traceId && (
              <p className="text-muted-foreground text-xs">trace_id：<span className="font-mono">{selected.traceId}</span></p>
            )}

            <div className="grid gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">终止会话（session id）</Label>
                <div className="flex gap-1">
                  <Input
                    className="h-8 text-xs"
                    value={target.terminate_session}
                    onChange={(e) => setTarget({ ...target, terminate_session: e.target.value })}
                  />
                  <Button size="sm" variant="destructive" disabled={busy || selected.status === "resolved"}
                    onClick={() => void runAction("terminate_session", target.terminate_session)}>
                    <Ban className="mr-1 h-3 w-3" />终止
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">吊销 PAT（pat id）</Label>
                <div className="flex gap-1">
                  <Input
                    className="h-8 text-xs"
                    value={target.revoke_pat}
                    onChange={(e) => setTarget({ ...target, revoke_pat: e.target.value })}
                  />
                  <Button size="sm" variant="destructive" disabled={busy || selected.status === "resolved"}
                    onClick={() => void runAction("revoke_pat", target.revoke_pat)}>
                    <Ban className="mr-1 h-3 w-3" />吊销
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">拉黑模型（providerId/modelName）</Label>
                <div className="flex gap-1">
                  <Input
                    className="h-8 text-xs"
                    value={target.block_model}
                    onChange={(e) => setTarget({ ...target, block_model: e.target.value })}
                  />
                  <Button size="sm" variant="destructive" disabled={busy || selected.status === "resolved"}
                    onClick={() => void runAction("block_model", target.block_model)}>
                    <Ban className="mr-1 h-3 w-3" />拉黑
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">禁用用户（user id，需二次确认）</Label>
                <div className="flex gap-1">
                  <Input
                    className="h-8 text-xs"
                    value={target.disable_user}
                    onChange={(e) => setTarget({ ...target, disable_user: e.target.value })}
                  />
                  <Button size="sm" variant="destructive" disabled={busy || selected.status === "resolved"}
                    onClick={() => setConfirmDialog({ action: "disable_user", targetId: target.disable_user, email: "" })}>
                    <Ban className="mr-1 h-3 w-3" />禁用
                  </Button>
                </div>
              </div>
            </div>

            {selected.status !== "resolved" && (
              <div className="flex items-center gap-2">
                {selected.status === "open" && (
                  <Button size="sm" variant="outline" disabled={busy}
                    onClick={() => void changeStatus("handling")}>
                    标记处置中
                  </Button>
                )}
                {selected.status === "handling" && (
                  <>
                    <Input
                      className="h-8 flex-1 text-xs"
                      placeholder="结案说明（必填）：根因、影响面、后续动作"
                      value={resolveNote}
                      onChange={(e) => setResolveNote(e.target.value)}
                    />
                    <Button size="sm" variant="outline" disabled={busy}
                      onClick={() => void changeStatus("resolved", resolveNote)}>
                      <CheckCircle2 className="mr-1 h-3 w-3" />结案
                    </Button>
                  </>
                )}
              </div>
            )}
            {selected.status === "resolved" && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">结案说明：{selected.resolutionNote ?? "—"}</span>
                <Button size="sm" variant="ghost" disabled={busy}
                  onClick={() => void changeStatus("handling")}>
                  重新打开
                </Button>
              </div>
            )}

            {actions.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium">处置动作历史（先审计后执行，网关链可查）</p>
                {actions.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 text-xs">
                    <Badge variant={item.outcome === "done" ? "secondary" : "destructive"}>
                      {item.outcome === "done" ? "成功" : "失败"}
                    </Badge>
                    <span>{ACTION_LABEL[item.actionType]}</span>
                    <span className="text-muted-foreground font-mono">{item.targetId}</span>
                    <span className="text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <Dialog open={confirmDialog !== null} onOpenChange={(open) => !open && setConfirmDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>二次确认：禁用用户</DialogTitle>
              <DialogDescription>
                该动作将禁用用户并吊销其全部 PAT、终止其全部登录会话，可能影响在线业务。请输入你的管理员邮箱以确认。
              </DialogDescription>
            </DialogHeader>
            <Input
              placeholder="输入管理员邮箱确认"
              value={confirmDialog?.email ?? ""}
              onChange={(e) => setConfirmDialog((prev) => (prev ? { ...prev, email: e.target.value } : prev))}
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmDialog(null)}>取消</Button>
              <Button
                variant="destructive"
                disabled={busy || !confirmDialog?.email.trim()}
                onClick={() => {
                  if (!confirmDialog) return;
                  void runAction("disable_user", confirmDialog.targetId, {
                    confirm: true,
                    confirmUserEmail: confirmDialog.email.trim(),
                  });
                }}
              >
                确认禁用
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
