"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  Skeleton,
  toast,
} from "@agenticx/ui";
import { ChevronDown, ChevronRight, FolderTree, MoreHorizontal, MoveRight, Pencil, Plus, RefreshCw, Save, Trash2, Users } from "lucide-react";
import { adminFetch } from "../lib/admin-client-auth";

type OrganizationNode = {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  memberCount?: number;
  children?: OrganizationNode[];
};

type ApiEnvelope<T> = { code: string; message: string; data?: T };

type OrganizationMember = {
  id: string;
  displayName: string;
  email: string;
  deptId: string | null;
  status: "active" | "disabled" | "locked";
};

async function loadOrganizationMembers(): Promise<OrganizationMember[]> {
  const items: OrganizationMember[] = [];
  let offset = 0;
  while (true) {
    const response = await adminFetch(`/api/admin/users?limit=200&offset=${offset}`, { cache: "no-store" });
    const json = (await response.json()) as ApiEnvelope<{ items: OrganizationMember[]; total: number }>;
    if (!response.ok || !json.data) throw new Error(json.message || "加载组织成员失败");
    items.push(...json.data.items);
    offset += json.data.items.length;
    if (offset >= json.data.total || json.data.items.length === 0) return items;
  }
}

function collectNodes(nodes: OrganizationNode[]): OrganizationNode[] {
  return nodes.flatMap((node) => [node, ...collectNodes(node.children ?? [])]);
}

function collectDescendantIds(node: OrganizationNode): Set<string> {
  return new Set(collectNodes(node.children ?? []).map((child) => child.id));
}

function findNode(nodes: OrganizationNode[], id: string | null): OrganizationNode | null {
  if (!id) return null;
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children ?? [], id);
    if (found) return found;
  }
  return null;
}

function TreeBranch({
  node,
  depth,
  selectedId,
  expandedIds,
  membersByDept,
  draggingMemberId,
  dropTargetDeptId,
  onSelect,
  onToggle,
  onDropTargetChange,
  onMemberDrop,
  onMemberDragStart,
  onMemberDragEnd,
  onMoveMember,
}: {
  node: OrganizationNode;
  depth: number;
  selectedId: string | null;
  expandedIds: Set<string>;
  membersByDept: Map<string | null, OrganizationMember[]>;
  draggingMemberId: string | null;
  dropTargetDeptId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onDropTargetChange: (deptId: string | null) => void;
  onMemberDrop: (memberId: string, deptId: string) => void;
  onMemberDragStart: (member: OrganizationMember) => void;
  onMemberDragEnd: () => void;
  onMoveMember: (member: OrganizationMember) => void;
}) {
  const children = node.children ?? [];
  const members = membersByDept.get(node.id) ?? [];
  const hasChildren = children.length > 0 || members.length > 0;
  const expanded = expandedIds.has(node.id);
  const selected = selectedId === node.id;
  return (
    <div>
      <button
        type="button"
        className={[
          "flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-sm transition-colors",
          selected || dropTargetDeptId === node.id
            ? "bg-primary/10 font-semibold text-primary"
            : "hover:bg-muted",
        ].join(" ")}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => {
          onSelect(node.id);
          if (hasChildren) onToggle(node.id);
        }}
        onDragOver={(event) => {
          if (!draggingMemberId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          onDropTargetChange(node.id);
        }}
        onDrop={(event) => {
          if (!draggingMemberId) return;
          event.preventDefault();
          onMemberDrop(draggingMemberId, node.id);
        }}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {hasChildren ? expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" /> : null}
        </span>
        <FolderTree className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {(node.memberCount ?? 0) > 0 ? <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{node.memberCount}</span> : null}
      </button>
      {expanded ? (
        <div>
          {children.map((child) => (
            <TreeBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              membersByDept={membersByDept}
              draggingMemberId={draggingMemberId}
              dropTargetDeptId={dropTargetDeptId}
              onSelect={onSelect}
              onToggle={onToggle}
              onDropTargetChange={onDropTargetChange}
              onMemberDrop={onMemberDrop}
              onMemberDragStart={onMemberDragStart}
              onMemberDragEnd={onMemberDragEnd}
              onMoveMember={onMoveMember}
            />
          ))}
          {members.map((member) => (
            <OrganizationMemberRow
              key={member.id}
              member={member}
              depth={depth}
              onDragStart={onMemberDragStart}
              onDragEnd={onMemberDragEnd}
              onMove={onMoveMember}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OrganizationMemberRow({
  member,
  depth = 0,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  member: OrganizationMember;
  depth?: number;
  onDragStart: (member: OrganizationMember) => void;
  onDragEnd: () => void;
  onMove: (member: OrganizationMember) => void;
}) {
  return (
    <div
      draggable
      className="group flex min-w-0 items-center gap-1 rounded-md pr-1 text-sm transition-colors hover:bg-muted"
      style={{ paddingLeft: `${32 + depth * 16}px` }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", member.id);
        onDragStart(member);
      }}
      onDragEnd={onDragEnd}
    >
      <Link
        href={`/iam/roles?user=${encodeURIComponent(member.id)}`}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{member.displayName.slice(0, 1)}</span>
        <span className="min-w-0 flex-1"><span className="block truncate">{member.displayName}</span><span className="block truncate text-[10px] text-muted-foreground">{member.email}</span></span>
        {member.status !== "active" ? <span className="shrink-0 text-[10px] text-amber-700 dark:text-amber-300">{member.status === "locked" ? "锁定" : "停用"}</span> : null}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={`${member.displayName} 的快捷操作`}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuLabel>用户操作</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={`/iam/roles?user=${encodeURIComponent(member.id)}`}>
              <Pencil className="mr-2 h-4 w-4" />编辑用户
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onMove(member)}>
            <MoveRight className="mr-2 h-4 w-4" />移动到组织
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function errorMessage(message: string): string {
  if (message === "dept_has_children") return "请先移动或删除子组织后再删除当前组织";
  if (message === "dept_has_members") return "请先将成员移动到其他组织后再删除当前组织";
  return message || "操作失败";
}

export function OrganizationEditor() {
  const [tree, setTree] = useState<OrganizationNode[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [draftName, setDraftName] = useState("");
  const [draftParentId, setDraftParentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [movingMember, setMovingMember] = useState<OrganizationMember | null>(null);
  const [moveTargetDeptId, setMoveTargetDeptId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [draggingMemberId, setDraggingMemberId] = useState<string | null>(null);
  const [dropTargetDeptId, setDropTargetDeptId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [response, loadedMembers] = await Promise.all([
        adminFetch("/api/admin/departments?shape=tree", { cache: "no-store" }),
        loadOrganizationMembers(),
      ]);
      const json = (await response.json()) as ApiEnvelope<{ items: OrganizationNode[] }>;
      if (!response.ok || !json.data?.items) throw new Error(json.message || "加载组织结构失败");
      setTree(json.data.items);
      setMembers(loadedMembers);
      setExpandedIds(new Set(collectNodes(json.data.items).map((node) => node.id)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载组织结构失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => findNode(tree, selectedId), [tree, selectedId]);
  const flatNodes = useMemo(() => collectNodes(tree), [tree]);
  const blockedParentIds = useMemo(() => selected ? new Set([selected.id, ...collectDescendantIds(selected)]) : new Set<string>(), [selected]);
  const membersByDept = useMemo(() => {
    const departmentIds = new Set(flatNodes.map((node) => node.id));
    const result = new Map<string | null, OrganizationMember[]>();
    for (const member of members) {
      const deptId = member.deptId && departmentIds.has(member.deptId) ? member.deptId : null;
      const current = result.get(deptId) ?? [];
      current.push(member);
      result.set(deptId, current);
    }
    for (const list of result.values()) list.sort((left, right) => left.displayName.localeCompare(right.displayName));
    return result;
  }, [flatNodes, members]);
  const unassignedMembers = membersByDept.get(null) ?? [];
  const moveTarget = useMemo(
    () => (moveTargetDeptId ? flatNodes.find((node) => node.id === moveTargetDeptId) ?? null : null),
    [flatNodes, moveTargetDeptId],
  );

  useEffect(() => {
    if (!selected) {
      setDraftName("");
      setDraftParentId(null);
      return;
    }
    setDraftName(selected.name);
    setDraftParentId(selected.parentId);
    setDeleteConfirm(false);
  }, [selected]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openMemberMove = (member: OrganizationMember, targetDeptId = member.deptId) => {
    setMovingMember(member);
    setMoveTargetDeptId(targetDeptId);
  };

  const handleMemberDrop = (memberId: string, targetDeptId: string) => {
    setDraggingMemberId(null);
    setDropTargetDeptId(null);
    const member = members.find((item) => item.id === memberId);
    if (!member || member.deptId === targetDeptId) return;
    openMemberMove(member, targetDeptId);
  };

  const moveMember = async () => {
    if (!movingMember || moving) return;
    setMoving(true);
    try {
      const response = await adminFetch(`/api/admin/users/${movingMember.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deptId: moveTargetDeptId }),
      });
      const json = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || json.code !== "00000") throw new Error(json.message || "移动用户失败");
      toast.success(`已将 ${movingMember.displayName} 移动至 ${moveTarget?.path ?? "未归属组织"}`);
      setMovingMember(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "移动用户失败");
    } finally {
      setMoving(false);
    }
  };

  const create = async () => {
    if (!createName.trim() || saving) return;
    setSaving(true);
    try {
      const response = await adminFetch("/api/admin/departments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: createName.trim(), parentId: createParentId }),
      });
      const json = (await response.json()) as ApiEnvelope<{ department?: OrganizationNode }>;
      if (!response.ok || json.code !== "00000") throw new Error(errorMessage(json.message));
      toast.success("组织已创建");
      setCreateOpen(false);
      setCreateName("");
      const createdId = json.data?.department?.id ?? null;
      await load();
      if (createdId) setSelectedId(createdId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建组织失败");
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!selected || !draftName.trim() || saving) return;
    setSaving(true);
    try {
      const response = await adminFetch(`/api/admin/departments/${selected.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: draftName.trim(), parentId: draftParentId }),
      });
      const json = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || json.code !== "00000") throw new Error(errorMessage(json.message));
      toast.success("组织结构已保存");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存组织失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected || !deleteConfirm || saving) return;
    setSaving(true);
    try {
      const response = await adminFetch(`/api/admin/departments/${selected.id}`, { method: "DELETE" });
      const json = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || json.code !== "00000") throw new Error(errorMessage(json.message));
      toast.success("组织已删除");
      setSelectedId(selected.parentId);
      setDeleteConfirm(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除组织失败");
    } finally {
      setSaving(false);
    }
  };

  const organizationTree = loading ? (
    <div className="space-y-3 p-3">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-4/5" />
      <Skeleton className="h-8 w-2/3" />
    </div>
  ) : tree.length || unassignedMembers.length ? (
    <div className="space-y-2">
      {tree.map((node) => (
        <TreeBranch
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          expandedIds={expandedIds}
          membersByDept={membersByDept}
          draggingMemberId={draggingMemberId}
          dropTargetDeptId={dropTargetDeptId}
          onSelect={setSelectedId}
          onToggle={toggleExpanded}
          onDropTargetChange={setDropTargetDeptId}
          onMemberDrop={handleMemberDrop}
          onMemberDragStart={(member) => {
            setDraggingMemberId(member.id);
            setDropTargetDeptId(null);
          }}
          onMemberDragEnd={() => {
            setDraggingMemberId(null);
            setDropTargetDeptId(null);
          }}
          onMoveMember={openMemberMove}
        />
      ))}
      {unassignedMembers.length ? (
        <div className={tree.length ? "border-t border-border pt-2" : "pt-1"}>
          <p className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground">
            <Users className="h-3.5 w-3.5" />未归属组织的用户
          </p>
          {unassignedMembers.map((member) => (
            <OrganizationMemberRow
              key={member.id}
              member={member}
              onDragStart={(item) => {
                setDraggingMemberId(item.id);
                setDropTargetDeptId(null);
              }}
              onDragEnd={() => {
                setDraggingMemberId(null);
                setDropTargetDeptId(null);
              }}
              onMove={openMemberMove}
            />
          ))}
        </div>
      ) : null}
    </div>
  ) : (
    <div className="p-6 text-center text-sm text-muted-foreground">还没有组织，请先创建顶层组织。</div>
  );

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2"><FolderTree className="h-5 w-5 text-primary" />组织结构</CardTitle>
          <CardDescription className="mt-1">在这里管理组织和组织下的成员；批量开通会继续在本页下方完成。</CardDescription>
        </div>
        <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} />刷新</Button><Button size="sm" onClick={() => { setCreateParentId(selectedId); setCreateOpen(true); }}><Plus />新增组织</Button></div>
      </CardHeader>
      <CardContent className="grid min-h-[390px] gap-4 border-t border-border pt-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.1fr)]">
        <div className="rounded-xl border border-border p-2">
          {organizationTree}
        </div>
        <div className="rounded-xl border border-border bg-muted/10 p-5">
          {selected ? <div className="space-y-5"><div className="flex items-center gap-2"><span className="rounded-lg bg-primary/10 p-2 text-primary"><Pencil className="h-4 w-4" /></span><div><p className="font-medium">编辑组织</p><p className="text-xs text-muted-foreground">成员 {selected.memberCount ?? 0} 人</p></div></div><div className="space-y-2"><Label htmlFor="organization-name">名称</Label><Input id="organization-name" value={draftName} onChange={(event) => setDraftName(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="organization-parent">上级组织</Label><select id="organization-parent" className="w-full rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm" value={draftParentId ?? ""} onChange={(event) => setDraftParentId(event.target.value || null)}><option value="">顶层组织</option>{flatNodes.filter((node) => !blockedParentIds.has(node.id)).map((node) => <option key={node.id} value={node.id}>{node.path}</option>)}</select><p className="text-xs text-muted-foreground">不能移动到自身或子组织之下。</p></div><div className="flex flex-wrap justify-between gap-2"><Button variant="outline" onClick={() => { setCreateParentId(selected.id); setCreateOpen(true); }}><Plus />新增下级</Button><Button onClick={() => void save()} disabled={saving || !draftName.trim()}><Save />保存组织</Button></div><div className="border-t border-border pt-5"><p className="text-sm font-medium text-destructive">删除当前组织</p><p className="mt-1 text-xs text-muted-foreground">只有没有成员和下级组织时才可删除。</p>{deleteConfirm ? <div className="mt-3 flex gap-2"><Button size="sm" variant="destructive" onClick={() => void remove()} disabled={saving}>再次确认删除</Button><Button size="sm" variant="outline" onClick={() => setDeleteConfirm(false)}>取消</Button></div> : <Button size="sm" variant="outline" className="mt-3 text-destructive hover:text-destructive" onClick={() => setDeleteConfirm(true)}><Trash2 />删除组织</Button>}</div></div> : <div className="flex h-full min-h-56 flex-col items-center justify-center text-center"><FolderTree className="h-8 w-8 text-muted-foreground" /><p className="mt-3 font-medium">选择一个组织进行编辑</p><p className="mt-1 text-sm text-muted-foreground">也可以直接新建顶层组织。</p></div>}
        </div>
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>新增组织</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2"><div className="space-y-2"><Label htmlFor="new-organization-name">名称</Label><Input id="new-organization-name" value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="例如：产品部" /></div><div className="space-y-2"><Label htmlFor="new-organization-parent">上级组织</Label><select id="new-organization-parent" className="w-full rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm" value={createParentId ?? ""} onChange={(event) => setCreateParentId(event.target.value || null)}><option value="">顶层组织</option>{flatNodes.map((node) => <option key={node.id} value={node.id}>{node.path}</option>)}</select></div></div>
          <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button onClick={() => void create()} disabled={saving || !createName.trim()}>{saving ? "创建中…" : "创建组织"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(movingMember)}
        onOpenChange={(open) => {
          if (!open && !moving) setMovingMember(null);
        }}
      >
        <DialogContent>
          <DialogHeader><DialogTitle>移动用户</DialogTitle></DialogHeader>
          {movingMember ? (
            <div className="space-y-4 py-2">
              <div className="rounded-xl border border-border bg-muted/20 p-3">
                <p className="font-medium">{movingMember.displayName}</p>
                <p className="mt-1 text-sm text-muted-foreground">{movingMember.email}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="move-member-department">目标组织</Label>
                <select
                  id="move-member-department"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm"
                  value={moveTargetDeptId ?? ""}
                  onChange={(event) => setMoveTargetDeptId(event.target.value || null)}
                >
                  <option value="">未归属组织</option>
                  {flatNodes.map((node) => <option key={node.id} value={node.id}>{node.path}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">用户的个人设置会保留，模型的组织范围会按新组织重新计算。</p>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovingMember(null)} disabled={moving}>取消</Button>
            <Button onClick={() => void moveMember()} disabled={moving || movingMember?.deptId === moveTargetDeptId}>
              {moving ? "移动中…" : "确认移动"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
