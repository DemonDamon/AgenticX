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
  Sheet,
  SheetContent,
  SheetTitle,
  toast,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";
import type { DepartmentTreeNode } from "@agenticx/feature-iam";
import {
  ChevronDown,
  ChevronRight,
  CornerRightUp,
  Download,
  FolderTree,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { VisibleModelsEditor } from "../../../components/visible-models-editor";

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

/* ---------- 左侧树节点组件 ---------- */
function TreeNode({
  node,
  depth,
  selectedId,
  expandedIds,
  onSelect,
  onToggle,
}: {
  node: DepartmentTreeNode;
  depth: number;
  selectedId: string | null;
  expandedIds: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => { onSelect(node.id); if (hasChildren) onToggle(node.id); }}
        style={{ paddingLeft: `${4 + depth * 14}px` }}
        className={[
          "group flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-sm transition-colors",
          isSelected
            ? "bg-primary/10 font-semibold text-primary"
            : "text-foreground/80 hover:bg-muted hover:text-foreground",
        ].join(" ")}
      >
        {/* 展开/折叠箭头 */}
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )
          ) : (
            <span className="h-3.5 w-3.5" />
          )}
        </span>

        {/* 部门图标（展开/折叠保持一致） */}
        <FolderTree
          className={[
            "h-3.5 w-3.5 shrink-0",
            isSelected ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
          ].join(" ")}
        />

        {/* 部门名 */}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>

        {/* 成员数角标 */}
        {node.memberCount > 0 && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground leading-none">
            {node.memberCount}
          </span>
        )}
      </button>

      {/* 子节点 */}
      {isExpanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- 收集所有 id ---------- */
function collectAllIds(nodes: DepartmentTreeNode[]): string[] {
  const ids: string[] = [];
  for (const n of nodes) {
    ids.push(n.id);
    if (n.children.length) ids.push(...collectAllIds(n.children));
  }
  return ids;
}

/* ================================================== */

export default function DepartmentsPage() {
  const t = useTranslations("pages.iam.departments");
  const tc = useTranslations("common");
  const [tree, setTree] = useState<DepartmentTreeNode[]>([]);
  const [loading, setLoading] = useState(true);

  // 左侧树：展开 id 集合（默认全展开）
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // 当前选中的部门（null = 根）
  const [currentDeptId, setCurrentDeptId] = useState<string | null>(null);

  // Modals state
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const [moveOpen, setMoveOpen] = useState(false);
  const [moveParentId, setMoveParentId] = useState<string | null>(null);

  // 统一部门设置 Sheet
  const [deptSettingsOpen, setDeptSettingsOpen] = useState(false);
  const [nameEditMode, setNameEditMode] = useState(false);
  const [draftName, setDraftName] = useState("");

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/departments?shape=tree", { cache: "no-store" });
      const json = (await res.json()) as ApiEnvelope<{ shape: string; items: ApiDept[] }>;
      if (!res.ok || !json.data?.items) {
        toast.error(json.message ?? t("toast.loadFailed"));
        return;
      }
      const nodes = json.data.items.map(mapApiToNode);
      setTree(nodes);
      // 首次加载：展开所有节点
      setExpandedIds(new Set(collectAllIds(nodes)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.networkError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

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

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

  async function handleSaveNameInline() {
    if (!currentNode || !draftName.trim()) return;
    const res = await fetch(`/api/admin/departments/${currentNode.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: draftName.trim() }),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? t("toast.saveFailed"));
      return;
    }
    toast.success(t("toast.nameUpdated"));
    setNameEditMode(false);
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
    <div className="flex h-full flex-col">
      {/* 顶部 PageHeader */}
      <div className="px-1 pb-1 pt-1">
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
      </div>

      {/* 主体：左树 + 右内容 */}
      <div className="flex min-h-0 flex-1 gap-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">

        {/* ── 左侧部门树 ── */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-border">
          {/* 树头部 */}
          <div className="border-b border-border px-3 py-3">
            <span className="text-sm font-semibold text-foreground">{t("treeTitle")}</span>
          </div>

          {/* 树内容 */}
          <nav className="flex-1 overflow-y-auto py-2 pl-1 pr-1">
            {/* 树节点 */}
            {loading ? (
              <div className="mt-4 flex items-center justify-center text-xs text-muted-foreground">
                <RefreshCw className="mr-1.5 h-3 w-3 animate-spin" />
                {t("loading")}
              </div>
            ) : (
              tree.map((node) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  selectedId={currentDeptId}
                  expandedIds={expandedIds}
                  onSelect={setCurrentDeptId}
                  onToggle={toggleExpand}
                />
              ))
            )}
          </nav>

          {/* 新建顶级部门 */}
          {currentDeptId === null && (
            <div className="border-t border-border p-2">
              <button
                type="button"
                onClick={() => { setNewName(""); setCreateOpen(true); }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("newTopDept")}
              </button>
            </div>
          )}
        </aside>

        {/* ── 右侧内容区 ── */}
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-background">
          {currentNode ? (
            /* 选中了某个部门 */
            <div className="flex flex-col">
              {/* 部门头部信息区 */}
              <div className="flex flex-col gap-3 border-b border-border p-3 px-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <h2 className="flex flex-wrap items-center gap-3 text-xl font-bold text-foreground">
                      {currentNode.name}
                      <Link
                        href={`/iam/users?dept=${currentNode.id}`}
                        title={t("membersLinkTitle")}
                      >
                        <Badge variant="secondary" className="cursor-pointer bg-muted hover:bg-muted/80 shadow-none">
                          <Users className="mr-1 h-3 w-3" />
                          {t("memberCount", { count: currentNode.memberCount })}
                        </Badge>
                      </Link>
                    </h2>
                    
                    {/* 路径面包屑（轻量版） */}
                    {breadcrumbs.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground ml-2">
                        <button
                          type="button"
                          onClick={() => setCurrentDeptId(null)}
                          className="hover:text-primary transition-colors"
                        >
                          {t("rootLabel")}
                        </button>
                        {breadcrumbs.map((b, i) => (
                          <React.Fragment key={b.id}>
                            <ChevronRight className="h-3 w-3" />
                            {i < breadcrumbs.length - 1 ? (
                              <button
                                type="button"
                                onClick={() => setCurrentDeptId(b.id)}
                                className="hover:text-primary transition-colors"
                              >
                                {b.name}
                              </button>
                            ) : (
                              <span className="font-semibold text-foreground">{b.name}</span>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      title={t("edit")}
                      onClick={() => { setNameEditMode(false); setDeptSettingsOpen(true); }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      title={t("move")}
                      onClick={() => { setMoveParentId(currentNode.parentId ?? null); setMoveOpen(true); }}
                    >
                      <CornerRightUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      title={t("delete")}
                      onClick={() => void handleDelete(currentNode.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* 子部门卡片网格 */}
              <div className="p-6 pb-10">
                {(childNodes.length > 0 || true) && (
                <div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {childNodes.map((child) => (
                      <Card
                        key={child.id}
                        className="group cursor-pointer transition-all hover:border-primary/40 hover:shadow-sm"
                        onClick={() => {
                          setCurrentDeptId(child.id);
                          if (!expandedIds.has(child.id)) toggleExpand(child.id);
                        }}
                      >
                        <CardHeader className="pb-2 pt-4">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                            <FolderTree className="h-4 w-4" />
                          </div>
                          <CardTitle className="mt-2 line-clamp-1 text-sm font-semibold" title={child.name}>
                            {child.name}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="pb-3">
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <Link
                              href={`/iam/users?dept=${child.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1 hover:text-primary transition-colors"
                            >
                              <Users className="h-3.5 w-3.5" />
                              {t("members", { count: child.memberCount })}
                            </Link>
                            <span className="flex items-center gap-1">
                              <FolderTree className="h-3.5 w-3.5" />
                              {t("subDepartments", { count: child.children.length })}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    ))}

                    {/* 新建子部门 */}
                    <button
                      onClick={() => { setNewName(""); setCreateOpen(true); }}
                      className="group flex min-h-[108px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-transparent text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted transition-colors group-hover:bg-primary/20">
                        <Plus className="h-4 w-4" />
                      </div>
                      <span className="text-sm font-medium">{t("newSubDept")}</span>
                    </button>
                  </div>
                </div>
              )}
              </div>
            </div>
          ) : (
            /* 根级：显示所有顶级部门卡片 */
            <div className="flex flex-col">
              <div className="flex items-center justify-between border-b border-border p-3 px-6">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold text-foreground">{t("rootLabel")}</h2>
                  <p className="text-xs text-muted-foreground ml-2">{t("rootHint")}</p>
                </div>
              </div>
              <div className="p-6 pb-10">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {tree.map((child) => (
                  <Card
                    key={child.id}
                    className="group cursor-pointer transition-all hover:border-primary/40 hover:shadow-sm"
                    onClick={() => {
                      setCurrentDeptId(child.id);
                      if (!expandedIds.has(child.id)) toggleExpand(child.id);
                    }}
                  >
                    <CardHeader className="pb-2 pt-4">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                        <FolderTree className="h-4 w-4" />
                      </div>
                      <CardTitle className="mt-2 line-clamp-1 text-sm font-semibold" title={child.name}>
                        {child.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-3">
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <Link
                          href={`/iam/users?dept=${child.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 hover:text-primary transition-colors"
                        >
                          <Users className="h-3.5 w-3.5" />
                          {t("members", { count: child.memberCount })}
                        </Link>
                        <span className="flex items-center gap-1">
                          <FolderTree className="h-3.5 w-3.5" />
                          {t("subDepartments", { count: child.children.length })}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                <button
                  onClick={() => { setNewName(""); setCreateOpen(true); }}
                  className="group flex min-h-[108px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-transparent text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted transition-colors group-hover:bg-primary/20">
                    <Plus className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-medium">{t("newTopDept")}</span>
                </button>
              </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── 部门设置 Sheet ── */}
      <Sheet open={deptSettingsOpen} onOpenChange={(open) => { setDeptSettingsOpen(open); if (!open) setNameEditMode(false); }}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
          <span className="sr-only">
            <SheetTitle>{currentNode?.name ?? t("edit")}</SheetTitle>
          </span>
          {/* 顶部：部门名 + 小铅笔 */}
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-6">
            <div className="min-w-0 flex-1">
              {nameEditMode ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSaveNameInline();
                      if (e.key === "Escape") setNameEditMode(false);
                    }}
                    className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xl font-bold leading-tight text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <Button size="sm" onClick={() => void handleSaveNameInline()}>{t("visibleModels.save")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setNameEditMode(false)}>{t("visibleModels.cancel")}</Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-2xl font-bold leading-tight text-foreground">{currentNode?.name}</h2>
                  <button
                    type="button"
                    title={t("editDialogTitle")}
                    onClick={() => { setDraftName(currentNode?.name ?? ""); setNameEditMode(true); }}
                    className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{currentNode?.path}</p>
            </div>
          </div>

          {/* 配置区 */}
          <div className="flex-1 space-y-0 divide-y divide-border">
            <div className="px-6 py-5">
              <div className="mb-4 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">{t("visibleModels.sheetTitle")}</span>
              </div>
              {currentNode ? (
                <VisibleModelsEditor
                  target={{ kind: "dept", id: currentNode.id }}
                  variant="sheet"
                  onClose={() => setDeptSettingsOpen(false)}
                />
              ) : null}
            </div>
            <div className="px-6 py-5">
              <div className="flex items-center gap-2 opacity-40">
                <span className="text-sm font-semibold text-foreground">{t("settings.permissionsTitle")}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t("settings.comingSoon")}</span>
              </div>
            </div>
            <div className="px-6 py-5">
              <div className="flex items-center gap-2 opacity-40">
                <span className="text-sm font-semibold text-foreground">{t("settings.securityTitle")}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t("settings.comingSoon")}</span>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

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
                onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{tc("actions.cancel")}</Button>
            <Button onClick={() => void handleCreate()}>{t("confirmCreate")}</Button>
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
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>{tc("actions.cancel")}</Button>
            <Button onClick={() => void handleMove()}>{t("confirmMove")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
