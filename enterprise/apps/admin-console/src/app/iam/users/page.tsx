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
import { MoreHorizontal, Pencil, Plus, RefreshCcw, ShieldCheck, ShieldX, Trash2, UserPlus, Users, Sparkles, Check } from "lucide-react";

type Status = "active" | "disabled" | "locked";

interface AdminUser {
  id: string;
  tenantId: string;
  deptId: string | null;
  email: string;
  displayName: string;
  status: Status;
  scopes: string[];
  roleCodes: string[];
  phone: string | null;
  employeeNo: string | null;
  jobTitle: string | null;
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
  data?: { user: AdminUser; initialPassword?: string };
};

const STATUS_META: Record<Status, { label: string; variant: "success" | "warning" | "destructive" }> = {
  active: { label: "启用", variant: "success" },
  disabled: { label: "停用", variant: "warning" },
  locked: { label: "锁定", variant: "destructive" },
};

interface ModelOption {
  id: string;
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
}

type DeptOption = { id: string; label: string };
type RoleOption = { id: string; code: string; name: string };

const PAGE_SIZE = 50;

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [userModels, setUserModels] = useState<string[]>([]);
  const [savingModels, setSavingModels] = useState(false);
  const [deptOptions, setDeptOptions] = useState<DeptOption[]>([]);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);

  const deptLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of deptOptions) m.set(d.id, d.label);
    return m;
  }, [deptOptions]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String((page - 1) * PAGE_SIZE));
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
  }, [statusFilter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/admin/departments?shape=flat", { cache: "no-store" });
        const json = (await res.json()) as {
          data?: { items: Array<{ id: string; name: string; path: string }> };
        };
        if (!alive || !json.data?.items) return;
        setDeptOptions(
          json.data.items.map((d) => ({
            id: d.id,
            label: `${d.name}（${d.path}）`,
          }))
        );
      } catch {
        /* 部门下拉仅辅助展示 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/admin/roles", { cache: "no-store" });
        const json = (await res.json()) as { data?: { items: RoleOption[] } };
        if (!alive || !json.data?.items) return;
        setRoleOptions(json.data.items.map((r) => ({ id: r.id, code: r.code, name: r.name })));
      } catch {
        /* silent */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 并行加载所有可分配的模型（来自管理员配置）
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/admin/providers", { cache: "no-store" });
        const json = (await res.json()) as {
          data?: {
            providers: Array<{
              id: string;
              displayName: string;
              enabled: boolean;
              apiKeyConfigured: boolean;
              models: Array<{ name: string; label: string; enabled: boolean }>;
            }>;
          };
        };
        if (!alive || !json.data) return;
        const opts: ModelOption[] = [];
        for (const p of json.data.providers) {
          if (!p.enabled) continue;
          for (const m of p.models) {
            if (!m.enabled) continue;
            opts.push({
              id: `${p.id}/${m.name}`,
              provider: p.id,
              providerLabel: p.displayName,
              model: m.name,
              label: m.label,
            });
          }
        }
        setModelOptions(opts);
      } catch {
        // 静默：模型分配仅是用户详情的子区域，加载失败不影响主页
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 选中某用户时拉取其当前的可见模型
  useEffect(() => {
    if (!selected) {
      setUserModels([]);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/admin/users/${selected.id}/models`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { data?: { modelIds: string[] } };
        if (alive && json.data) setUserModels(json.data.modelIds);
      } catch {
        // 静默
      }
    })();
    return () => {
      alive = false;
    };
  }, [selected?.id]);

  const handleToggleUserModel = async (modelId: string) => {
    if (!selected) return;
    const next = userModels.includes(modelId)
      ? userModels.filter((m) => m !== modelId)
      : [...userModels, modelId];
    setUserModels(next);
    setSavingModels(true);
    try {
      const res = await fetch(`/api/admin/users/${selected.id}/models`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelIds: next }),
      });
      const json = (await res.json()) as { data?: { modelIds: string[] }; message?: string };
      if (!res.ok || !json.data) {
        toast.error(json.message ?? "保存失败");
        return;
      }
      setUserModels(json.data.modelIds);
    } finally {
      setSavingModels(false);
    }
  };

  const handleCreate = async (input: Record<string, unknown>) => {
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json()) as ApiUserResp;
    if (!res.ok || !json.data?.user) {
      toast.error(json.message ?? "创建失败");
      return false;
    }
    toast.success(`已创建用户 ${json.data.user.email}`);
    if (json.data.initialPassword) {
      toast.success(`初始密码（仅此一次）：${json.data.initialPassword}`, { duration: 15_000 });
      try {
        await navigator.clipboard.writeText(json.data.initialPassword);
        toast.success("初始密码已复制到剪贴板");
      } catch {
        /* ignore */
      }
    }
    await load();
    return true;
  };

  const handleUpdate = async (id: string, patch: Partial<AdminUser> & Record<string, unknown>) => {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as ApiUserResp;
    if (!res.ok || !json.data?.user) {
      toast.error(json.message ?? "更新失败");
      return false;
    }
    toast.success("已更新");
    await load();
    if (selected?.id === id) setSelected(json.data.user);
    return true;
  };

  const handleResetPassword = async (user: AdminUser) => {
    const res = await fetch(`/api/admin/users/${user.id}/reset-password`, { method: "POST" });
    const json = (await res.json()) as { data?: { initialPassword?: string }; message?: string };
    if (!res.ok || !json.data?.initialPassword) {
      toast.error(json.message ?? "重置失败");
      return;
    }
    toast.success(`新密码（仅此一次）：${json.data.initialPassword}`, { duration: 15_000 });
    try {
      await navigator.clipboard.writeText(json.data.initialPassword);
      toast.success("新密码已复制到剪贴板");
    } catch {
      /* ignore */
    }
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
          <span className="text-sm text-muted-foreground" title={row.original.deptId ?? ""}>
            {row.original.deptId ? (deptLabelMap.get(row.original.deptId) ?? row.original.deptId) : "—"}
          </span>
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
    [selected?.id, deptLabelMap]
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
        description={`共 ${total} 位用户 · 每页 ${PAGE_SIZE} 条 · 支持搜索 / 筛选 / 批量操作 / 详情抽屉`}
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
              onClearFilters={() => {
                setStatusFilter("all");
                setPage(1);
              }}
              onRowClick={(row) => {
                setSelected(row.original);
                setEditOpen(false);
              }}
              toolbarLeft={
                <Select
                  value={statusFilter}
                  onValueChange={(value) => {
                    setPage(1);
                    setStatusFilter(value as "all" | Status);
                  }}
                >
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
                toast.success(`已导出本页 ${users.length} 条记录`);
              }}
              getRowId={(row) => row.id}
            />
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2 text-sm text-muted-foreground">
        <span>
          第 {page} / {Math.max(1, Math.ceil(total / PAGE_SIZE))} 页 · 共 {total} 人
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          上一页
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= Math.max(1, Math.ceil(total / PAGE_SIZE)) || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          下一页
        </Button>
      </div>

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
                <DetailRow
                  label="部门"
                  value={
                    selected.deptId ? (deptLabelMap.get(selected.deptId) ?? selected.deptId) : "—"
                  }
                />
                <DetailRow label="手机" value={selected.phone ?? "—"} />
                <DetailRow label="工号" value={selected.employeeNo ?? "—"} />
                <DetailRow label="职位" value={selected.jobTitle ?? "—"} />
                <DetailRow
                  label="角色"
                  value={
                    selected.roleCodes?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {selected.roleCodes.map((c) => (
                          <Badge key={c} variant="outline" className="font-mono text-[10px]">
                            {c}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      "—"
                    )
                  }
                />
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

                <div className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-sm font-semibold">
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                        可见模型分配
                      </div>
                      <div className="text-xs text-muted-foreground">
                        勾选后该用户登录前台仅能看到这些模型；未勾选时无可用模型
                      </div>
                    </div>
                    <Badge variant="soft" className="text-[10px]">
                      已选 {userModels.length} / 可选 {modelOptions.length}
                    </Badge>
                  </div>
                  {modelOptions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      尚无可分配模型，请先到「平台配置 · 模型服务」启用厂商与模型。
                    </p>
                  ) : (
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {modelOptions.map((opt) => {
                        const checked = userModels.includes(opt.id);
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => void handleToggleUserModel(opt.id)}
                            disabled={savingModels}
                            className={[
                              "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                              checked
                                ? "border-primary bg-primary-soft/50 text-foreground"
                                : "border-border bg-surface-card hover:bg-muted",
                            ].join(" ")}
                          >
                            <Check
                              className={[
                                "h-3.5 w-3.5 shrink-0",
                                checked ? "text-primary" : "opacity-0",
                              ].join(" ")}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{opt.label}</div>
                              <div className="truncate text-[10px] text-muted-foreground">
                                {opt.providerLabel} · <span className="font-mono">{opt.model}</span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                <Button variant="outline" className="flex-1 min-w-[100px]" onClick={() => setEditOpen(true)}>
                  <Pencil />
                  编辑
                </Button>
                <Button variant="outline" className="flex-1 min-w-[100px]" onClick={() => void handleResetPassword(selected)}>
                  重置密码
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
        roleOptions={roleOptions}
        deptOptions={deptOptions}
        onSubmit={async (values) => {
          const ok = await handleCreate({
            email: values.email,
            displayName: values.displayName,
            status: values.status,
            deptId: values.deptId || null,
            phone: values.phone || null,
            employeeNo: values.employeeNo || null,
            jobTitle: values.jobTitle || null,
            roleCodes: values.roleCodes.length ? values.roleCodes : undefined,
            initialPassword: values.initialPassword || undefined,
          });
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
        roleOptions={roleOptions}
        deptOptions={deptOptions}
        initial={
          selected
            ? {
                email: selected.email,
                displayName: selected.displayName,
                status: selected.status,
                deptId: selected.deptId ?? "",
                phone: selected.phone ?? "",
                employeeNo: selected.employeeNo ?? "",
                jobTitle: selected.jobTitle ?? "",
                roleCodes: selected.roleCodes ?? [],
                initialPassword: "",
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
            phone: values.phone || null,
            employeeNo: values.employeeNo || null,
            jobTitle: values.jobTitle || null,
            roleCodes: values.roleCodes,
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
  phone: string;
  employeeNo: string;
  jobTitle: string;
  roleCodes: string[];
  initialPassword: string;
}

const EMPTY_USER_FORM: UserFormValues = {
  email: "",
  displayName: "",
  status: "active",
  deptId: "",
  phone: "",
  employeeNo: "",
  jobTitle: "",
  roleCodes: ["member"],
  initialPassword: "",
};

function UserFormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  initial,
  emailReadOnly,
  deptOptions,
  roleOptions,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  description?: React.ReactNode;
  submitLabel: string;
  initial?: UserFormValues;
  emailReadOnly?: boolean;
  deptOptions: DeptOption[];
  roleOptions: RoleOption[];
  onSubmit: (values: UserFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<UserFormValues>(() => initial ?? EMPTY_USER_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(initial ?? EMPTY_USER_FORM);
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
              <Label>部门</Label>
              <Select
                value={values.deptId || "__none__"}
                onValueChange={(v) => setValues((prev) => ({ ...prev, deptId: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择部门" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">（未分配）</SelectItem>
                  {deptOptions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="user-phone">手机</Label>
              <Input
                id="user-phone"
                value={values.phone}
                onChange={(e) => setValues((prev) => ({ ...prev, phone: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-eno">工号</Label>
              <Input
                id="user-eno"
                value={values.employeeNo}
                onChange={(e) => setValues((prev) => ({ ...prev, employeeNo: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-job">职位</Label>
            <Input
              id="user-job"
              value={values.jobTitle}
              onChange={(e) => setValues((prev) => ({ ...prev, jobTitle: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>角色</Label>
            <div className="grid max-h-40 gap-1.5 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
              {roleOptions.map((r) => {
                const checked = values.roleCodes.includes(r.code);
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={[
                      "flex items-center gap-2 rounded px-2 py-1 text-left text-xs",
                      checked ? "bg-primary-soft ring-1 ring-primary" : "hover:bg-muted",
                    ].join(" ")}
                    onClick={() =>
                      setValues((prev) => {
                        const next = new Set(prev.roleCodes);
                        if (next.has(r.code)) next.delete(r.code);
                        else next.add(r.code);
                        const arr = [...next];
                        return { ...prev, roleCodes: arr.length ? arr : ["member"] };
                      })
                    }
                  >
                    <span
                      className={[
                        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                        checked ? "border-primary bg-primary text-primary-foreground" : "border-border",
                      ].join(" ")}
                    >
                      {checked ? <Check className="h-2.5 w-2.5" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="font-mono text-[10px] text-muted-foreground">{r.code}</span> · {r.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          {!emailReadOnly ? (
            <div className="space-y-1.5">
              <Label htmlFor="user-init-pw">初始密码（可选，留空则自动生成）</Label>
              <Input
                id="user-init-pw"
                type="password"
                autoComplete="new-password"
                value={values.initialPassword}
                onChange={(e) => setValues((prev) => ({ ...prev, initialPassword: e.target.value }))}
              />
            </div>
          ) : null}

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
