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
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  toast,
} from "@agenticx/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Pencil, Plus, RefreshCcw, ShieldCheck, ShieldX, Trash2, UserPlus, Users } from "lucide-react";

type Status = "active" | "disabled" | "locked";

interface AdminUser {
  id: string;
  tenantId: string;
  deptId: string | null;
  email: string;
  displayName: string;
  status: Status;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
}

type ApiListResp = {
  code: string;
  message: string;
  data?: { items: AdminUser[]; total: number };
};

type ApiUserResp = {
  code: string;
  message: string;
  data?: { user: AdminUser };
};

const STATUS_META: Record<Status, { label: string; variant: "success" | "warning" | "destructive" }> = {
  active: { label: "启用", variant: "success" },
  disabled: { label: "停用", variant: "warning" },
  locked: { label: "锁定", variant: "destructive" },
};

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("limit", "100");
      const res = await fetch(`/api/admin/users?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as ApiListResp;
      if (res.ok && json.data) {
        setUsers(json.data.items);
        setTotal(json.data.total);
      } else {
        toast.error(json.message ?? "加载失败");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "网络错误");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (input: { email: string; displayName: string; status: Status; deptId: string }) => {
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json()) as ApiUserResp;
    if (!res.ok || !json.data) {
      toast.error(json.message ?? "创建失败");
      return false;
    }
    toast.success(`已创建用户 ${json.data.user.email}`);
    await load();
    return true;
  };

  const handleUpdate = async (id: string, patch: Partial<AdminUser>) => {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as ApiUserResp;
    if (!res.ok || !json.data) {
      toast.error(json.message ?? "更新失败");
      return false;
    }
    toast.success("已更新");
    await load();
    if (selected?.id === id) setSelected(json.data.user);
    return true;
  };

  const handleDelete = async (user: AdminUser) => {
    if (!window.confirm(`确认删除用户 ${user.email}？该操作不可撤销。`)) return;
    const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = (await res.json()) as { message?: string };
      toast.error(json.message ?? "删除失败");
      return;
    }
    toast.success(`已删除 ${user.email}`);
    if (selected?.id === user.id) setSelected(null);
    await load();
  };

  const handleQuickToggleStatus = async (user: AdminUser) => {
    const next: Status = user.status === "active" ? "disabled" : "active";
    await handleUpdate(user.id, { status: next });
  };

  const columns = useMemo<ColumnDef<AdminUser>[]>(
    () => [
      {
        accessorKey: "displayName",
        header: "用户",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
              {row.original.displayName.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{row.original.displayName}</div>
              <div className="truncate text-xs text-muted-foreground">{row.original.email}</div>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "deptId",
        header: "部门",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.deptId ?? "—"}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => {
          const meta = STATUS_META[row.original.status];
          return <Badge variant={meta.variant}>{meta.label}</Badge>;
        },
      },
      {
        accessorKey: "scopes",
        header: "权限数",
        cell: ({ row }) => (
          <Badge variant="soft" className="gap-1">
            <ShieldCheck className="h-3 w-3" />
            {row.original.scopes.length}
          </Badge>
        ),
      },
      {
        accessorKey: "updatedAt",
        header: "更新时间",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {new Date(row.original.updatedAt).toLocaleString("zh-CN", { hour12: false })}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={(event) => event.stopPropagation()}
                  aria-label="更多操作"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>快速操作</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelected(row.original);
                    setEditOpen(true);
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  编辑
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleQuickToggleStatus(row.original);
                  }}
                >
                  {row.original.status === "active" ? (
                    <>
                      <ShieldX className="mr-2 h-4 w-4" />
                      停用
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      启用
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-danger focus:text-danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleDelete(row.original);
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected?.id]
  );

  const activeFilters = useMemo(() => {
    if (statusFilter === "all") return [];
    return [
      {
        id: "status",
        label: `状态：${STATUS_META[statusFilter].label}`,
        onRemove: () => setStatusFilter("all"),
      },
    ];
  }, [statusFilter]);

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
              <BreadcrumbItem>身份与权限</BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>用户</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="用户管理"
        description={`共 ${total} 位用户 · 支持搜索 / 筛选 / 批量操作 / 详情抽屉`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCcw />
              刷新
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <UserPlus />
              新建用户
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="pt-5">
          {loading && users.length === 0 ? (
            <EmptyState
              icon={<Users className="h-5 w-5" />}
              title="加载中..."
              description="正在从 /api/admin/users 拉取用户列表"
              size="sm"
              className="border-0"
            />
          ) : (
            <DataTable
              columns={columns}
              data={users}
              searchPlaceholder="按邮箱 / 姓名 / ID 搜索..."
              activeFilters={activeFilters}
              onClearFilters={() => setStatusFilter("all")}
              onRowClick={(row) => {
                setSelected(row.original);
                setEditOpen(false);
              }}
              toolbarLeft={
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as "all" | Status)}>
                  <SelectTrigger className="h-9 w-[140px]">
                    <SelectValue placeholder="全部状态" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部状态</SelectItem>
                    <SelectItem value="active">启用</SelectItem>
                    <SelectItem value="disabled">停用</SelectItem>
                    <SelectItem value="locked">锁定</SelectItem>
                  </SelectContent>
                </Select>
              }
              onExport={() => {
                const csv = [
                  ["id", "email", "displayName", "status", "deptId", "createdAt"].join(","),
                  ...users.map((user) =>
                    [user.id, user.email, user.displayName, user.status, user.deptId ?? "", user.createdAt]
                      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
                      .join(",")
                  ),
                ].join("\n");
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success(`已导出 ${users.length} 条记录`);
              }}
              getRowId={(row) => row.id}
            />
          )}
        </CardContent>
      </Card>

      {/* 详情抽屉 */}
      <Sheet open={!!selected && !editOpen} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-xl">
          {selected ? (
            <div className="flex h-full flex-col gap-4">
              <SheetHeader>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-base font-semibold text-primary">
                    {selected.displayName.slice(0, 1)}
                  </span>
                  <div className="min-w-0">
                    <SheetTitle className="truncate">{selected.displayName}</SheetTitle>
                    <SheetDescription className="truncate">{selected.email}</SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <div className="flex-1 space-y-4 overflow-y-auto pr-1">
                <DetailRow label="用户 ID" value={<span className="font-mono text-xs">{selected.id}</span>} />
                <DetailRow label="租户" value={<span className="font-mono text-xs">{selected.tenantId}</span>} />
                <DetailRow label="部门" value={selected.deptId ?? "—"} />
                <DetailRow
                  label="状态"
                  value={<Badge variant={STATUS_META[selected.status].variant}>{STATUS_META[selected.status].label}</Badge>}
                />
                <DetailRow
                  label="权限作用域"
                  value={
                    <div className="flex flex-wrap gap-1">
                      {selected.scopes.length === 0 ? (
                        <span className="text-sm text-muted-foreground">无</span>
                      ) : (
                        selected.scopes.map((scope) => (
                          <Badge key={scope} variant="soft" className="font-mono text-[10px]">
                            {scope}
                          </Badge>
                        ))
                      )}
                    </div>
                  }
                />
                <DetailRow
                  label="创建时间"
                  value={<span className="font-mono text-xs">{new Date(selected.createdAt).toLocaleString("zh-CN")}</span>}
                />
                <DetailRow
                  label="更新时间"
                  value={<span className="font-mono text-xs">{new Date(selected.updatedAt).toLocaleString("zh-CN")}</span>}
                />
              </div>

              <div className="flex gap-2 border-t border-border pt-3">
                <Button variant="outline" className="flex-1" onClick={() => setEditOpen(true)}>
                  <Pencil />
                  编辑
                </Button>
                <Button
                  variant={selected.status === "active" ? "outline" : "default"}
                  className="flex-1"
                  onClick={() => void handleQuickToggleStatus(selected)}
                >
                  {selected.status === "active" ? <ShieldX /> : <ShieldCheck />}
                  {selected.status === "active" ? "停用" : "启用"}
                </Button>
                <Button variant="destructive" onClick={() => void handleDelete(selected)}>
                  <Trash2 />
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* 新建 */}
      <UserFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="新建用户"
        description="创建后用户将立即出现在 workspace 可登录列表"
        submitLabel="创建"
        onSubmit={async (values) => {
          const ok = await handleCreate(values);
          if (ok) setCreateOpen(false);
        }}
      />

      {/* 编辑 */}
      <UserFormDialog
        open={editOpen && !!selected}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setSelected(selected);
        }}
        title="编辑用户"
        description={selected?.email}
        submitLabel="保存"
        initial={
          selected
            ? {
                email: selected.email,
                displayName: selected.displayName,
                status: selected.status,
                deptId: selected.deptId ?? "",
              }
            : undefined
        }
        emailReadOnly
        onSubmit={async (values) => {
          if (!selected) return;
          const ok = await handleUpdate(selected.id, {
            displayName: values.displayName,
            status: values.status,
            deptId: values.deptId || null,
          });
          if (ok) setEditOpen(false);
        }}
      />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-3 border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-foreground">{value}</span>
    </div>
  );
}

interface UserFormValues {
  email: string;
  displayName: string;
  status: Status;
  deptId: string;
}

function UserFormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  initial,
  emailReadOnly,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  description?: React.ReactNode;
  submitLabel: string;
  initial?: UserFormValues;
  emailReadOnly?: boolean;
  onSubmit: (values: UserFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<UserFormValues>(
    () => initial ?? { email: "", displayName: "", status: "active", deptId: "" }
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(initial ?? { email: "", displayName: "", status: "active", deptId: "" });
    }
  }, [open, initial]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(values);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="user-email">邮箱</Label>
            <Input
              id="user-email"
              type="email"
              required
              value={values.email}
              onChange={(event) => setValues((prev) => ({ ...prev, email: event.target.value }))}
              readOnly={emailReadOnly}
              placeholder="user@your-company.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-name">姓名</Label>
            <Input
              id="user-name"
              required
              value={values.displayName}
              onChange={(event) => setValues((prev) => ({ ...prev, displayName: event.target.value }))}
              placeholder="例如：张三"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>状态</Label>
              <Select
                value={values.status}
                onValueChange={(value) => setValues((prev) => ({ ...prev, status: value as Status }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">启用</SelectItem>
                  <SelectItem value="disabled">停用</SelectItem>
                  <SelectItem value="locked">锁定</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-dept">部门 ID（可选）</Label>
              <Input
                id="user-dept"
                value={values.deptId}
                onChange={(event) => setValues((prev) => ({ ...prev, deptId: event.target.value }))}
                placeholder="dept_xxx"
              />
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              <Plus />
              {submitting ? "处理中..." : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
