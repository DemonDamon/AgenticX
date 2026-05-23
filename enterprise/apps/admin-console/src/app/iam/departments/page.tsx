"use client";
import { adminFetch } from "../../../lib/admin-client-auth";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Input,
  Label,
  PageHeader,
  toast,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";
import type { DepartmentTreeNode } from "@agenticx/feature-iam";
import { Download, Pencil, Plus, RefreshCw, Trash2, FolderTree, Users, ChevronRight, CornerRightUp } from "lucide-react";

type ApiDept = {
  id: string;
  tenantId: string;
  orgId: string;
  parentId: string | null;
  name: string;
  path: string;
  memberCount?: number;
  createdAt: string;
  updatedAt: string;
  children?: ApiDept[];
};

type ApiEnvelope<T> = { code: string; message: string; data?: T };

function mapApiToNode(n: ApiDept): DepartmentTreeNode {
  return {
    id: n.id,
    tenantId: n.tenantId,
    parentId: n.parentId,
    name: n.name,
    path: n.path,
    memberCount: n.memberCount ?? 0,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    children: (n.children ?? []).map(mapApiToNode),
  };
}

function findNode(nodes: DepartmentTreeNode[], id: string): DepartmentTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const c = findNode(n.children, id);
    if (c) return c;
  }
  return null;
}

function getBreadcrumbPath(nodes: DepartmentTreeNode[], targetId: string | null): DepartmentTreeNode[] {
  if (!targetId) return [];
  const path: DepartmentTreeNode[] = [];
  function dfs(current: DepartmentTreeNode[], currentPath: DepartmentTreeNode[]): boolean {
    for (const n of current) {
      if (n.id === targetId) {
        path.push(...currentPath, n);
        return true;
      }
      if (n.children.length > 0) {
        if (dfs(n.children, [...currentPath, n])) return true;
      }
    }
    return false;
  }
  dfs(nodes, []);
  return path;
}

export default function DepartmentsPage() {
  const t = useTranslations("pages.iam.departments");
  const tc = useTranslations("common");
  const ts = useTranslations("shell");
  const [tree, setTree] = useState<DepartmentTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Drill-down state
  const [currentDeptId, setCurrentDeptId] = useState<string | null>(null);

  // Modals state
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");

  const [moveOpen, setMoveOpen] = useState(false);
  const [moveParentId, setMoveParentId] = useState<string | null>(null);

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/departments?shape=tree", { cache: "no-store" });
      const json = (await res.json()) as ApiEnvelope<{ shape: string; items: ApiDept[] }>;
      if (!res.ok || !json.data?.items) {
        toast.error(json.message ?? t("toast.loadFailed"));
        return;
      }
      setTree(json.data.items.map(mapApiToNode));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.networkError"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  const currentNode = currentDeptId ? findNode(tree, currentDeptId) : null;
  const childNodes = currentNode ? currentNode.children : tree;
  const breadcrumbs = getBreadcrumbPath(tree, currentDeptId);

  const flatForParentSelect = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    const walk = (nodes: DepartmentTreeNode[], depth: number) => {
      for (const n of nodes) {
        out.push({ id: n.id, label: `${"—".repeat(depth)} ${n.name}` });
        if (n.children.length) walk(n.children, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [tree]);

  async function handleCreate() {
    if (!newName.trim()) return;
    const res = await adminFetch("/api/admin/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), parentId: currentDeptId }),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? t("toast.createFailed"));
      return;
    }
    toast.success(t("toast.created"));
    setCreateOpen(false);
    setNewName("");
    await loadTree();
  }

  async function handleSaveName() {
    if (!currentNode || !editName.trim()) return;
    const res = await fetch(`/api/admin/departments/${currentNode.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim() }),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? t("toast.saveFailed"));
      return;
    }
    toast.success(t("toast.nameUpdated"));
    setEditOpen(false);
    await loadTree();
  }

  async function handleMove() {
    if (!currentNode) return;
    const res = await fetch(`/api/admin/departments/${currentNode.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: moveParentId }),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? t("toast.moveFailed"));
      return;
    }
    toast.success(t("toast.moved"));
    setMoveOpen(false);
    await loadTree();
  }

  async function handleDelete(id: string) {
    if (!confirm(t("confirmDelete"))) return;
    const res = await fetch(`/api/admin/departments/${id}`, { method: "DELETE" });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? t("toast.deleteFailed"));
      return;
    }
    toast.success(t("toast.deleted"));
    if (currentDeptId === id) {
      setCurrentDeptId(currentNode?.parentId ?? null);
    }
    await loadTree();
  }

  async function exportStructure() {
    const res = await adminFetch("/api/admin/departments?shape=flat", { cache: "no-store" });
    const json = (await res.json()) as ApiEnvelope<{ shape: string; items: ApiDept[] }>;
    if (!res.ok || !json.data?.items) {
      toast.error(json.message ?? t("toast.exportFailed"));
      return;
    }
    const rows = json.data.items;
    const header = ["id", "name", "parent_id", "path", "member_count"];
    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [r.id, r.name, r.parentId ?? "", r.path, String(r.memberCount ?? 0)]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      ),
    ];
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `departments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("toast.exportSuccess", { count: rows.length }));
  }

  return (
    <div className="space-y-6 p-1 pb-10">
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
              <BreadcrumbItem>{t("breadcrumbIam")}</BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{t("breadcrumbDepartments")}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadTree()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {t("refresh")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void exportStructure()}>
              <Download className="mr-2 h-4 w-4" />
              {t("exportStructure")}
            </Button>
          </div>
        }
      />

      {/* 面包屑导航栏（钻取用） */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card p-2 shadow-sm">
        <Button
          variant={currentDeptId === null ? "secondary" : "ghost"}
          size="sm"
          className="font-medium"
          onClick={() => setCurrentDeptId(null)}
        >
          <FolderTree className="mr-2 h-4 w-4" />
          {t("rootLabel")}
        </Button>

        {breadcrumbs.map((b) => (
          <React.Fragment key={b.id}>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
            <Button
              variant={currentDeptId === b.id ? "secondary" : "ghost"}
              size="sm"
              className="font-medium"
              onClick={() => setCurrentDeptId(b.id)}
            >
              {b.name}
            </Button>
          </React.Fragment>
        ))}
      </div>

      {/* 当前部门的信息与操作栏 */}
      {currentNode && (
        <Card className="overflow-hidden border-primary/20 bg-primary/5 shadow-sm">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="space-y-1.5">
              <h3 className="flex items-center gap-3 text-lg font-bold text-foreground">
                {currentNode.name}
                <Link 
                  href={`/iam/users?dept=${currentNode.id}`}
                  className="inline-flex items-center hover:opacity-80 transition-opacity"
                  title={t("membersLinkTitle")}
                >
                  <Badge variant="secondary" className="bg-background shadow-sm hover:bg-muted cursor-pointer">
                    {t("memberCount", { count: currentNode.memberCount })}
                  </Badge>
                </Link>
              </h3>
              <p className="break-all font-mono text-xs text-muted-foreground">Path: {currentNode.path}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="bg-background"
                onClick={() => {
                  setEditName(currentNode.name);
                  setEditOpen(true);
                }}
              >
                <Pencil className="mr-2 h-4 w-4" /> {t("edit")}
              </Button>
              <Button
                variant="outline"
                className="bg-background"
                onClick={() => {
                  setMoveParentId(currentNode.parentId ?? null);
                  setMoveOpen(true);
                }}
              >
                <CornerRightUp className="mr-2 h-4 w-4" /> {t("move")}
              </Button>
              <Button
                variant="destructive"
                className="bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => void handleDelete(currentNode.id)}
              >
                <Trash2 className="mr-2 h-4 w-4" /> {t("delete")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 当前层级的子部门卡片网格 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {childNodes.map((child) => (
          <Card
            key={child.id}
            className="group relative flex cursor-pointer flex-col overflow-hidden transition-all hover:border-primary/50 hover:shadow-md"
            onClick={() => setCurrentDeptId(child.id)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <FolderTree className="h-5 w-5" />
                </div>
              </div>
              <CardTitle className="mt-3 line-clamp-1 text-base leading-relaxed" title={child.name}>
                {child.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="mt-auto">
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <Link 
                  href={`/iam/users?dept=${child.id}`} 
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1.5 hover:text-primary transition-colors" 
                  title={t("membersLinkTitle")}
                >
                  <Users className="h-4 w-4" />
                  {t("members", { count: child.memberCount })}
                </Link>
                <div className="flex items-center gap-1.5" title={t("drillInTitle")}>
                  <FolderTree className="h-4 w-4" />
                  {t("subDepartments", { count: child.children.length })}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {/* 新建子部门占位卡片 */}
        <button
          onClick={() => {
            setNewName("");
            setCreateOpen(true);
          }}
          className="group flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-transparent px-4 py-6 text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted transition-colors group-hover:bg-primary/20">
            <Plus className="h-5 w-5" />
          </div>
          <span className="font-medium">{currentNode ? t("newSubDept") : t("newTopDept")}</span>
        </button>
      </div>

      {/* --- 对话框区域 --- */}

      {/* 新建对话框 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
<DialogTitle>{currentNode ? t("createDialogUnder", { name: currentNode.name }) : t("createDialogRoot")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("deptNameLabel")}</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("deptNamePlaceholder")}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={() => void handleCreate()}>{t("confirmCreate")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑对话框 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("newNameLabel")}</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSaveName();
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              {tc("actions.cancel")}
            </Button>
<Button onClick={() => void handleSaveName()}>{tc("actions.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 移动对话框 */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("moveDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("moveParentLabel")}</Label>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={moveParentId ?? ""}
                onChange={(e) => setMoveParentId(e.target.value || null)}
              >
                <option value="">{t("moveToRoot")}</option>
                {flatForParentSelect
                  .filter((o) => o.id !== currentDeptId)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={() => void handleMove()}>{t("confirmMove")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
