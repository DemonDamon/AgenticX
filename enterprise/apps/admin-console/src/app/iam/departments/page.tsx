"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  PageHeader,
  toast,
} from "@agenticx/ui";
import { DepartmentTree } from "@agenticx/feature-iam";
import type { DepartmentTreeNode } from "@agenticx/feature-iam";
import { Download, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

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

export default function DepartmentsPage() {
  const [tree, setTree] = useState<DepartmentTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [parentForCreate, setParentForCreate] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [moveParentId, setMoveParentId] = useState<string | null>(null);

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/departments?shape=tree", { cache: "no-store" });
      const json = (await res.json()) as ApiEnvelope<{ shape: string; items: ApiDept[] }>;
      if (!res.ok || !json.data?.items) {
        toast.error(json.message ?? "加载失败");
        return;
      }
      setTree(json.data.items.map(mapApiToNode));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "网络错误");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  const selected = selectedId ? findNode(tree, selectedId) : null;

  useEffect(() => {
    if (selected) {
      setEditName(selected.name);
      setMoveParentId(selected.parentId ?? null);
    }
  }, [selected?.id, selected?.name, selected?.parentId]);

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
    const res = await fetch("/api/admin/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), parentId: parentForCreate }),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? "创建失败");
      return;
    }
    toast.success("已创建部门");
    setCreateOpen(false);
    setNewName("");
    setParentForCreate(null);
    await loadTree();
  }

  async function handleSaveName() {
    if (!selected || !editName.trim()) return;
    const res = await fetch(`/api/admin/departments/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim() }),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? "保存失败");
      return;
    }
    toast.success("已更新名称");
    await loadTree();
  }

  async function handleMove() {
    if (!selected) return;
    const res = await fetch(`/api/admin/departments/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: moveParentId }),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? "移动失败");
      return;
    }
    toast.success("已移动部门");
    await loadTree();
  }

  async function handleDelete() {
    if (!selected) return;
    const res = await fetch(`/api/admin/departments/${selected.id}`, { method: "DELETE" });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? "删除失败");
      return;
    }
    toast.success("已删除");
    setSelectedId(null);
    await loadTree();
  }

  async function exportStructure() {
    const res = await fetch("/api/admin/departments?shape=flat", { cache: "no-store" });
    const json = (await res.json()) as ApiEnvelope<{ shape: string; items: ApiDept[] }>;
    if (!res.ok || !json.data?.items) {
      toast.error(json.message ?? "导出失败");
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
    toast.success(`已导出 ${rows.length} 行`);
  }

  return (
    <div className="space-y-5 p-1">
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
              <BreadcrumbItem>身份与权限</BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>部门</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="部门管理"
        description="组织树与 path 由服务端维护，可与用户部门、用量按部门维度联动。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadTree()} disabled={loading}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => void exportStructure()}>
              <Download className="mr-1 h-4 w-4" />
              导出结构
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  新建部门
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>新建部门</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label>上级部门</Label>
                    <select
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      value={parentForCreate ?? ""}
                      onChange={(e) => setParentForCreate(e.target.value || null)}
                    >
                      <option value="">（根级）</option>
                      {flatForParentSelect.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>名称</Label>
                    <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例如：研发中心" />
                  </div>
                  <Button className="w-full" onClick={() => void handleCreate()}>
                    创建
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <Card className="p-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : (
            <DepartmentTree
              nodes={tree}
              selectedDepartmentId={selectedId ?? undefined}
              onSelect={(id) => setSelectedId(id)}
            />
          )}
        </Card>

        <Card className="p-6 space-y-4">
          {!selected ? (
            <p className="text-sm text-muted-foreground">在左侧选择部门查看详情</p>
          ) : (
            <>
              <div>
                <h3 className="text-lg font-semibold">{selected.name}</h3>
                <p className="font-mono text-xs text-muted-foreground break-all">path: {selected.path}</p>
                <p className="text-xs text-muted-foreground">成员数: {selected.memberCount}</p>
              </div>
              <div className="space-y-2">
                <Label>编辑名称</Label>
                <div className="flex flex-wrap gap-2">
                  <Input className="max-w-md" value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <Button variant="outline" onClick={() => void handleSaveName()}>
                    <Pencil className="mr-1 h-4 w-4" />
                    保存名称
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>移动到</Label>
                <div className="flex flex-wrap gap-2">
                  <select
                    className="max-w-md flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                    value={moveParentId ?? ""}
                    onChange={(e) => setMoveParentId(e.target.value || null)}
                  >
                    <option value="">（根级）</option>
                    {flatForParentSelect
                      .filter((o) => o.id !== selected.id)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                  </select>
                  <Button variant="secondary" onClick={() => void handleMove()}>
                    应用移动
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setParentForCreate(selected.id);
                    setNewName("");
                    setCreateOpen(true);
                  }}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  新建子部门
                </Button>
                <Button variant="destructive" size="sm" onClick={() => void handleDelete()}>
                  <Trash2 className="mr-1 h-4 w-4" />
                  删除
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
