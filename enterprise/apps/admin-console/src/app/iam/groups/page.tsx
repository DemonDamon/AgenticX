"use client";

import Link from "next/link";
import { OrganizationEditor } from "../../../components/OrganizationEditor";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Textarea,
  toast,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@agenticx/ui";
import { ChevronDown, ChevronRight, CirclePlus, FolderTree, Pencil, RefreshCw, Trash2, UsersRound } from "lucide-react";
import { adminFetch } from "../../../lib/admin-client-auth";
import { UserDetailEditor, type UserDetailTarget } from "../../../components/UserDetailEditor";

type OverviewMember = { id: string; displayName: string; email: string; deptId: string | null; usedTokens: number };
type GroupMemberOverview = OverviewMember & {
  monthlyTokens: number;
  unlimited: boolean;
  hasIndividualQuotaOverride: boolean;
  individualExtraModelIds: string[];
  hasIndividualOverride: boolean;
};
type OrganizationNode = { id: string; name: string; parentId: string | null; path: string; memberCount: number };
type GroupQuotaOverview = {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
  modelIds: string[];
  memberCount: number;
  members: GroupMemberOverview[];
};
type UserQuotaSnapshot = {
  id: string;
  usedTokens: number;
  monthlyTokens: number;
  unlimited: boolean;
};
type ModelOption = { id: string; providerLabel: string; label: string };
type ApiEnvelope<T> = { code: string; message: string; data?: T };
type EditorForm = { name: string; description: string; memberIds: string[]; modelIds: string[] };

const EMPTY_FORM: EditorForm = { name: "", description: "", memberIds: [], modelIds: [] };

function MemberQuotaRing({
  used,
  limit,
  unlimited,
}: {
  used: number;
  limit: number;
  unlimited: boolean;
}) {
  const safeUsed = Math.max(0, Number(used) || 0);
  const safeLimit = Math.max(0, Number(limit) || 0);
  const remainingRatio = unlimited || safeLimit <= 0 ? 1 : Math.max(0, Math.min(1, (safeLimit - safeUsed) / safeLimit));
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * remainingRatio;
  const stateClass = remainingRatio <= 0 ? "stroke-destructive" : remainingRatio <= 0.2 ? "stroke-amber-500" : "stroke-primary";

  return (
    <span
      role="img"
      aria-label={unlimited ? "每月额度未设上限" : "每月额度剩余状态"}
      title={unlimited ? "未设上限" : "额度剩余"}
      className="h-8 w-8 shrink-0"
    >
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="10" className="stroke-muted" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          className={stateClass}
          style={{ strokeDasharray: `${dash} ${circumference}` }}
        />
      </svg>
    </span>
  );
}

function applyMemberQuotaSnapshots(groups: GroupQuotaOverview[], snapshots: UserQuotaSnapshot[]): GroupQuotaOverview[] {
  const quotaByUserId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  return groups.map((group) => ({
    ...group,
    members: group.members.map((member) => {
      const quota = quotaByUserId.get(member.id);
      return quota
        ? {
            ...member,
            usedTokens: quota.usedTokens,
            monthlyTokens: quota.monthlyTokens,
            unlimited: quota.unlimited,
          }
        : member;
    }),
  }));
}

function organizationChildren(nodes: OrganizationNode[]) {
  const children = new Map<string | null, OrganizationNode[]>();
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    const parent = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(node);
    children.set(parent, siblings);
  }
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return children;
}

function MemberLine({
  member,
  checked,
  selectable,
  onToggle,
}: {
  member: OverviewMember;
  checked?: boolean;
  selectable?: boolean;
  onToggle?: (id: string) => void;
}) {
  if (!selectable) {
    return (
      <div className="flex min-w-0 flex-col rounded-md px-2 py-1.5 text-sm">
        <span className="truncate">{member.displayName}</span>
        <span className="truncate text-xs text-muted-foreground">{member.email}</span>
      </div>
    );
  }
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
      <Checkbox checked={checked} onCheckedChange={() => onToggle?.(member.id)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{member.displayName}</span>
        <span className="block truncate text-xs text-muted-foreground">{member.email}</span>
      </span>
    </label>
  );
}

function OrganizationBranch({
  node,
  children,
  membersByDept,
  selectedIds,
  selectable,
  onToggle,
  depth = 0,
}: {
  node: OrganizationNode;
  children: Map<string | null, OrganizationNode[]>;
  membersByDept: Map<string | null, OverviewMember[]>;
  selectedIds: Set<string>;
  selectable?: boolean;
  onToggle?: (id: string) => void;
  depth?: number;
}) {
  const childNodes = children.get(node.id) ?? [];
  const members = membersByDept.get(node.id) ?? [];
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = childNodes.length > 0 || members.length > 0;
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => hasChildren && setOpen((value) => !value)}
      >
        {hasChildren
          ? open
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />
          : <span className="w-4" />}
        <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
        <span className="text-xs text-muted-foreground">{node.memberCount}</span>
      </button>
      {open ? (
        <div>
          {members.map((member) => (
            <div key={member.id} style={{ paddingLeft: `${24 + depth * 16}px` }}>
              <MemberLine member={member} selectable={selectable} checked={selectedIds.has(member.id)} onToggle={onToggle} />
            </div>
          ))}
          {childNodes.map((child) => (
            <OrganizationBranch
              key={child.id}
              node={child}
              children={children}
              membersByDept={membersByDept}
              selectedIds={selectedIds}
              selectable={selectable}
              onToggle={onToggle}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OrganizationTree({
  nodes,
  users,
  selectedIds = new Set<string>(),
  selectable = false,
  onToggle,
}: {
  nodes: OrganizationNode[];
  users: OverviewMember[];
  selectedIds?: Set<string>;
  selectable?: boolean;
  onToggle?: (id: string) => void;
}) {
  const children = useMemo(() => organizationChildren(nodes), [nodes]);
  const membersByDept = useMemo(() => {
    const result = new Map<string | null, OverviewMember[]>();
    const departmentIds = new Set(nodes.map((node) => node.id));
    for (const user of users) {
      const departmentId = user.deptId && departmentIds.has(user.deptId) ? user.deptId : null;
      const current = result.get(departmentId) ?? [];
      current.push(user);
      result.set(departmentId, current);
    }
    for (const current of result.values()) current.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return result;
  }, [nodes, users]);
  const roots = children.get(null) ?? [];
  const unassigned = membersByDept.get(null) ?? [];
  return (
    <div className="space-y-1">
      {roots.map((node) => (
        <OrganizationBranch
          key={node.id}
          node={node}
          children={children}
          membersByDept={membersByDept}
          selectedIds={selectedIds}
          selectable={selectable}
          onToggle={onToggle}
        />
      ))}
      {unassigned.length > 0 ? (
        <div className="pt-1">
          <p className="px-2 py-1 text-xs font-medium text-muted-foreground">未归属组织</p>
          {unassigned.map((member) => (
            <MemberLine key={member.id} member={member} selectable={selectable} checked={selectedIds.has(member.id)} onToggle={onToggle} />
          ))}
        </div>
      ) : null}
      {roots.length === 0 && unassigned.length === 0 ? <p className="px-2 py-4 text-sm text-muted-foreground">暂无用户</p> : null}
    </div>
  );
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<GroupQuotaOverview[]>([]);
  const [organization, setOrganization] = useState<OrganizationNode[]>([]);
  const [users, setUsers] = useState<OverviewMember[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgOpen, setOrgOpen] = useState(false);
  const [editing, setEditing] = useState<GroupQuotaOverview | null | "new">(null);
  const [form, setForm] = useState<EditorForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingMember, setEditingMember] = useState<UserDetailTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [groupsResponse, userQuotaResponse] = await Promise.all([
        adminFetch("/api/admin/user-groups/overview", { cache: "no-store" }),
        adminFetch("/api/admin/users/quota-overview", { cache: "no-store" }),
      ]);
      const groupsJson = (await groupsResponse.json()) as ApiEnvelope<{
        groups: GroupQuotaOverview[];
        organization: OrganizationNode[];
        users: OverviewMember[];
      }>;
      const userQuotaJson = (await userQuotaResponse.json()) as ApiEnvelope<{ items: UserQuotaSnapshot[] }>;
      if (!groupsResponse.ok || groupsJson.code !== "00000") throw new Error(groupsJson.message || "加载用户组失败");
      if (!userQuotaResponse.ok || userQuotaJson.code !== "00000") throw new Error(userQuotaJson.message || "加载用户额度失败");
      setGroups(applyMemberQuotaSnapshots(groupsJson.data?.groups ?? [], userQuotaJson.data?.items ?? []));
      setOrganization(groupsJson.data?.organization ?? []);
      setUsers(groupsJson.data?.users ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载用户组失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadModelOptions = useCallback(async () => {
    try {
      const response = await adminFetch("/api/admin/providers", { cache: "no-store" });
      const json = (await response.json()) as {
        data?: {
          providers: Array<{
            id: string;
            displayName: string;
            enabled: boolean;
            models: Array<{ name: string; label: string; enabled: boolean }>;
          }>;
        };
      };
      const options = (json.data?.providers ?? []).flatMap((provider) =>
        provider.enabled
          ? provider.models
              .filter((model) => model.enabled)
              .map((model) => ({
                id: `${provider.id}/${model.name}`,
                providerLabel: provider.displayName,
                label: model.label || model.name,
              }))
          : [],
      );
      setModelOptions(options.sort((a, b) => a.providerLabel.localeCompare(b.providerLabel) || a.label.localeCompare(b.label)));
    } catch {
      setModelOptions([]);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadModelOptions();
  }, [load, loadModelOptions]);

  const openCreate = () => {
    setEditing("new");
    setConfirmDelete(false);
    setForm({ ...EMPTY_FORM });
  };

  const openEdit = (group: GroupQuotaOverview) => {
    setEditing(group);
    setConfirmDelete(false);
    setForm({
      name: group.name,
      description: group.description ?? "",
      memberIds: group.memberIds,
      modelIds: group.modelIds,
    });
  };



  const toggleMember = (id: string) => {
    setForm((current) => ({
      ...current,
      memberIds: current.memberIds.includes(id)
        ? current.memberIds.filter((memberId) => memberId !== id)
        : [...current.memberIds, id],
    }));
  };

  const toggleModel = (id: string) => {
    setForm((current) => ({
      ...current,
      modelIds: current.modelIds.includes(id)
        ? current.modelIds.filter((modelId) => modelId !== id)
        : [...current.modelIds, id],
    }));
  };

  const save = async () => {
    if (!editing || saving) return;
    if (!form.name.trim()) return toast.error("请输入用户组名称");
    setSaving(true);
    try {
      const isNew = editing === "new";
      const response = await adminFetch(isNew ? "/api/admin/user-groups" : `/api/admin/user-groups/${editing.id}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = (await response.json()) as ApiEnvelope<{ removedMissingMembers?: number }>;
      if (!response.ok || json.code !== "00000") throw new Error(json.message || "保存失败");
      const removedMissingMembers = json.data?.removedMissingMembers ?? 0;
      toast.success(
        removedMissingMembers > 0
          ? `已自动移除 ${removedMissingMembers} 位已删除成员，用户组设置已保存`
          : isNew
            ? "用户组已创建并应用到成员"
            : "用户组设置已应用到成员",
      );
      setEditing(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing || editing === "new" || !confirmDelete || saving) return;
    setSaving(true);
    try {
      const response = await adminFetch(`/api/admin/user-groups/${editing.id}`, { method: "DELETE" });
      const json = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || json.code !== "00000") throw new Error(json.message || "删除失败");
      toast.success("用户组已删除；成员和个人特例会保留");
      setEditing(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    } finally {
      setSaving(false);
    }
  };

  const selectedIds = useMemo(() => new Set(form.memberIds), [form.memberIds]);
  const selectedModelIds = useMemo(() => new Set(form.modelIds), [form.modelIds]);
  const modelLabels = useMemo(() => new Map(modelOptions.map((model) => [model.id, model])), [modelOptions]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">批量成员基线</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">用户组</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            用户组统一管理成员名单、每人月额度和基础可用模型；Token 始终按每个用户单独计量，个人可在用户页面增加特例。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setOrgOpen(true)}>
            <FolderTree />编辑组织结构
          </Button>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} />刷新
          </Button>
          <Button onClick={openCreate}><CirclePlus />新建用户组</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {loading && groups.length === 0
          ? [1, 2, 3].map((key) => (
              <Card key={key} className="min-h-72">
                <CardHeader><Skeleton className="h-6 w-36" /><Skeleton className="h-4 w-48" /></CardHeader>
                <CardContent className="space-y-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-24 w-full" /></CardContent>
              </Card>
            ))
          : null}
        {!loading && groups.length === 0 ? (
          <Card className="border-dashed md:col-span-2 2xl:col-span-3">
            <CardContent className="flex min-h-64 flex-col items-center justify-center text-center">
              <span className="rounded-full bg-primary/10 p-3 text-primary"><UsersRound className="h-6 w-6" /></span>
              <h2 className="mt-4 font-semibold">先创建一个用户组</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">例如按组织、项目或岗位把用户放在一起，批量设置每人的额度和基础模型。</p>
              <Button className="mt-4" onClick={openCreate}>新建用户组</Button>
            </CardContent>
          </Card>
        ) : null}
        {groups.map((group) => (
          <Card
            key={group.id}
            className="group cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/20"
            onClick={() => openEdit(group)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="truncate">{group.name}</CardTitle>
                  <CardDescription className="mt-1 line-clamp-2 min-h-10">{group.description || "批量管理成员的额度和基础可用模型"}</CardDescription>
                </div>
                <Badge variant="secondary" className="shrink-0">成员 {group.memberCount}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">成员</p>
                  <span className="inline-flex items-center gap-1 text-xs text-primary"><Pencil className="h-3 w-3" />编辑用户组</span>
                </div>
                <div className="grid max-h-72 gap-2 overflow-y-auto rounded-xl border border-border p-2 sm:grid-cols-2">
                  {group.members.length ? group.members.map((member) => (
                    <button
                      type="button"
                      key={member.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        setEditingMember(member);
                      }}
                      className="flex min-w-0 items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-left text-sm transition-colors hover:border-primary/50 hover:bg-muted"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{member.displayName.slice(0, 1)}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate font-medium">{member.displayName}</span><span className="block truncate text-xs text-muted-foreground">{member.email}</span></span>
                      {member.hasIndividualOverride ? <Badge variant="outline" className="shrink-0 border-amber-500/50 px-1 py-0 text-[10px] text-amber-700 dark:text-amber-300">个人特例</Badge> : null}
                      <MemberQuotaRing used={member.usedTokens} limit={member.monthlyTokens} unlimited={member.unlimited} />
                    </button>
                  )) : <span className="p-2 text-sm text-muted-foreground">尚未选择成员</span>}
                </div>
              </section>
              <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border pt-3">
                <section className="min-w-0 flex-1 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">基础可用模型</p>
                  <div className="flex flex-wrap gap-1.5">
                    {group.modelIds.length ? group.modelIds.map((modelId) => {
                      const model = modelLabels.get(modelId);
                      return <Badge key={modelId} variant="outline" className="max-w-full truncate font-normal">{model?.label ?? modelId}</Badge>;
                    }) : <span className="text-sm text-muted-foreground">未指定基础模型</span>}
                  </div>
                </section>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Sheet open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-2xl">
          {editing ? (
            <>
              <SheetHeader className="shrink-0 border-b border-border pb-5 pr-8">
                <SheetTitle>{editing === "new" ? "新建用户组" : `编辑 ${editing.name}`}</SheetTitle>
                <SheetDescription className="mt-1">保存后会为成员应用每人月额度；基础模型在运行时自动继承，成员可以在用户页面额外开通或关闭模型。</SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto py-6 pr-1">
                <div className="space-y-2">
                  <Label htmlFor="group-name">用户组名称</Label>
                  <Input id="group-name" value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} placeholder="例如：项目成员" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="group-description">说明（可选）</Label>
                  <Textarea id="group-description" value={form.description} onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))} placeholder="说明这组用户采用同一套设置的原因" className="min-h-20" />
                </div>
                <section className="space-y-3">
                  <div>
                    <h2 className="text-sm font-medium">基础可用模型</h2>
                    <p className="mt-1 text-xs text-muted-foreground">组内成员会拿到这些模型；所在部门的上限仍然优先，超出上限的进不来。属于多个组的人取并集。</p>
                  </div>
                  <div className="grid max-h-64 gap-2 overflow-y-auto rounded-xl border border-border p-3 sm:grid-cols-2">
                    {modelOptions.length ? modelOptions.map((model) => (
                      <label key={model.id} className="flex cursor-pointer items-start gap-2 rounded-lg p-2 text-sm hover:bg-muted">
                        <Checkbox checked={selectedModelIds.has(model.id)} onCheckedChange={() => toggleModel(model.id)} />
                        <span className="min-w-0"><span className="block truncate font-medium">{model.label}</span><span className="block truncate text-xs text-muted-foreground">{model.providerLabel} · {model.id}</span></span>
                      </label>
                    )) : <p className="col-span-full p-2 text-sm text-muted-foreground">暂无可下发的已启用模型</p>}
                  </div>
                </section>
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-medium">从组织结构选择用户</h2>
                      <p className="mt-1 text-xs text-muted-foreground">已选择 {form.memberIds.length} 位用户；组织归属不会改变。</p>
                    </div>
                    <Badge variant="secondary">{form.memberIds.length} 人</Badge>
                  </div>
                  <div className="max-h-[360px] overflow-y-auto rounded-xl border border-border p-2">
                    <OrganizationTree nodes={organization} users={users} selectable selectedIds={selectedIds} onToggle={toggleMember} />
                  </div>
                  <p className="text-xs text-muted-foreground">同一用户可属于多个用户组，可见模型取并集；额度按人单独设置，不再随用户组下发。</p>
                </section>
                {editing !== "new" ? (
                  <section className="space-y-3 border-t border-border pt-5">
                    <div>
                      <h2 className="text-sm font-medium text-destructive">删除用户组</h2>
                      <p className="mt-1 text-xs text-muted-foreground">不会删除用户、组织结构或该用户已有的个人设置。</p>
                    </div>
                    {confirmDelete ? (
                      <div className="flex items-center gap-2">
                        <Button variant="destructive" size="sm" onClick={() => void remove()} disabled={saving}>再次确认删除</Button>
                        <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>取消</Button>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                        <Trash2 />删除用户组
                      </Button>
                    )}
                  </section>
                ) : null}
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-border pt-4">
                <Button variant="outline" onClick={() => setEditing(null)}>关闭</Button>
                <Button onClick={() => void save()} disabled={saving}>{saving ? "保存中…" : "保存并应用"}</Button>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <UserDetailEditor
        target={editingMember}
        onOpenChange={(open) => {
          if (!open) setEditingMember(null);
        }}
        onChanged={load}
      />
    {/* 组织结构直接在这儿编，不再跳去 /iam/bulk-import 那个老页面。
        跳走的代价是回来之后这一页的数据是旧的，而且那页还带着一整套批量导入。 */}
      <Dialog open={orgOpen} onOpenChange={(open) => { setOrgOpen(open); if (!open) void load(); }}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>组织结构</DialogTitle>
            <DialogDescription>增删部门、调整层级。改完关窗，本页会重新加载。</DialogDescription>
          </DialogHeader>
          <OrganizationEditor />
        </DialogContent>
      </Dialog>

    </div>
  );
}
