"use client";
import { adminFetch } from "../../../lib/admin-client-auth";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
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
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import {
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  RefreshCcw,
  ShieldCheck,
  ShieldX,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { CreateUserDialog } from "../../../components/CreateUserDialog";
import {
  UserFormDialog,
  type UserFormDeptOption,
  type UserFormRoleOption,
  type UserFormStatus,
} from "../../../components/UserFormDialog";
import { VisibleModelsEditor } from "../../../components/visible-models-editor";

type Status = UserFormStatus;

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

function getStatusMeta(t: ReturnType<typeof useTranslations<"pages.iam.users">>) {
  return {
    active: { label: t("status.active"), variant: "success" as const },
    disabled: { label: t("status.disabled"), variant: "warning" as const },
    locked: { label: t("status.locked"), variant: "destructive" as const },
  } satisfies Record<Status, { label: string; variant: "success" | "warning" | "destructive" }>;
}

type DeptOption = UserFormDeptOption;
type RoleOption = UserFormRoleOption;

const PAGE_SIZE = 50;
type UserViewMode = "list" | "cards";

function UsersPageContent() {
  const t = useTranslations("pages.iam.users");
  const statusMeta = useMemo(() => getStatusMeta(t), [t]);
  const searchParams = useSearchParams();
  const initialDept = searchParams.get("dept") || "all";
  const initialUserId = searchParams.get("userId") || searchParams.get("user") || "";
  const initialCreate = searchParams.get("create") === "1";

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const [deptFilter, setDeptFilter] = useState<string>(initialDept);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<UserViewMode>("list");
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [createOpen, setCreateOpen] = useState(initialCreate);
  const [editOpen, setEditOpen] = useState(false);
  const [deptOptions, setDeptOptions] = useState<DeptOption[]>([]);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const deptLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of deptOptions) m.set(d.id, d.label);
    return m;
  }, [deptOptions]);

  const selectedInitial = useMemo(
    () =>
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
        : undefined,
    [selected],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (deptFilter !== "all") params.set("deptId", deptFilter);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String((page - 1) * PAGE_SIZE));
      const res = await fetch(`/api/admin/users?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as ApiListResp;
      if (res.ok && json.data) {
        setUsers(json.data.items);
        setTotal(json.data.total);
      } else {
        toast.error(json.message ?? t("toast.loadFailed"));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.networkError"));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, deptFilter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!initialUserId || loading) return;
    const user = users.find((item) => item.id === initialUserId);
    if (user && selected?.id !== user.id) {
      setSelected(user);
      setEditOpen(true);
      return;
    }

    if (user || selected?.id === initialUserId) return;
    let alive = true;
    void (async () => {
      try {
        const res = await adminFetch(`/api/admin/users/${encodeURIComponent(initialUserId)}`, { cache: "no-store" });
        const json = (await res.json()) as ApiUserResp;
        if (alive && res.ok && json.data?.user) {
          setSelected(json.data.user);
          setEditOpen(true);
        }
      } catch {
        /* 详情入口仅用于定位用户，列表本身仍可正常使用 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [initialUserId, loading, selected?.id, users]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await adminFetch("/api/admin/departments?shape=flat", { cache: "no-store" });
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
        const res = await adminFetch("/api/auth/session", { cache: "no-store" });
        const json = (await res.json()) as { data?: { userId?: string } };
        if (alive) setCurrentUserId(json.data?.userId ?? null);
      } catch {
        /* 删除接口仍会在服务端阻止删除当前登录用户。 */
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
        const res = await adminFetch("/api/admin/roles", { cache: "no-store" });
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

  const handleUpdate = async (id: string, patch: Partial<AdminUser> & Record<string, unknown>) => {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as ApiUserResp;
    if (!res.ok || !json.data?.user) {
      toast.error(json.message ?? t("toast.saveFailed"));
      return false;
    }
    toast.success(t("toast.updated"));
    await load();
    if (selected?.id === id) setSelected(json.data.user);
    return true;
  };

  const handleResetPassword = async (user: AdminUser) => {
    const res = await fetch(`/api/admin/users/${user.id}/reset-password`, { method: "POST" });
    const json = (await res.json()) as { data?: { initialPassword?: string }; message?: string };
    if (!res.ok || !json.data?.initialPassword) {
      toast.error(json.message ?? t("toast.resetFailed"));
      return;
    }
    toast.success(`${t("toast.newPassword")}${json.data.initialPassword}`, { duration: 15_000 });
    try {
      await navigator.clipboard.writeText(json.data.initialPassword);
      toast.success(t("toast.newPasswordCopied"));
    } catch {
      /* ignore */
    }
  };

  const handleDelete = async (user: AdminUser) => {
    if (user.id === currentUserId) {
      toast.error("不能删除当前登录用户");
      return;
    }
    if (!window.confirm(t("toast.deleteConfirm", { email: user.email }))) return;
    const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = (await res.json()) as { message?: string };
      toast.error(json.message ?? t("toast.deleteFailed"));
      return;
    }
    toast.success(`${t("toast.deleted")} ${user.email}`);
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
        header: t("breadcrumbUsers"),
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
        header: t("columns.department"),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground" title={row.original.deptId ?? ""}>
            {row.original.deptId ? (deptLabelMap.get(row.original.deptId) ?? row.original.deptId) : "—"}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: t("columns.status"),
        cell: ({ row }) => {
          const meta = statusMeta[row.original.status];
          return <Badge variant={meta.variant}>{meta.label}</Badge>;
        },
      },
      {
        accessorKey: "scopes",
        header: t("columns.scopeCount"),
        cell: ({ row }) => (
          <Badge variant="soft" className="gap-1">
            <ShieldCheck className="h-3 w-3" />
            {row.original.scopes.length}
          </Badge>
        ),
      },
      {
        accessorKey: "updatedAt",
        header: t("columns.updatedAt"),
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
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              title={t("actions.edit")}
              aria-label={t("actions.edit")}
              onClick={(event) => {
                event.stopPropagation();
                setSelected(row.original);
                setEditOpen(true);
              }}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-danger hover:bg-danger/10 hover:text-danger"
              title={row.original.id === currentUserId ? "不能删除当前登录用户" : t("actions.delete")}
              aria-label={t("actions.delete")}
              disabled={row.original.id === currentUserId}
              onClick={(event) => {
                event.stopPropagation();
                void handleDelete(row.original);
              }}
            >
              <Trash2 />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={(event) => event.stopPropagation()}
                  aria-label={t("actions.more")}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>{t("actions.quickActions")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelected(row.original);
                    setEditOpen(false);
                  }}
                >
                  {t("actions.viewDetails")}
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
                      {t("actions.disable")}
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      {t("actions.enable")}
                    </>
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [currentUserId, selected?.id, deptLabelMap]
  );

  const activeFilters = useMemo(() => {
    const filters: Array<{ id: string; label: string; onRemove: () => void }> = [];
    if (searchQuery.trim()) {
      filters.push({
        id: "search",
        label: `${t("filterLabels.search")}${searchQuery.trim()}`,
        onRemove: () => setSearchQuery(""),
      });
    }
    if (statusFilter !== "all") {
      filters.push({
        id: "status",
        label: `${t("filterLabels.status")}${statusMeta[statusFilter].label}`,
        onRemove: () => setStatusFilter("all"),
      });
    }
    if (deptFilter !== "all") {
      filters.push({
        id: "dept",
        label: `${t("filterLabels.department")}${deptLabelMap.get(deptFilter) ?? deptFilter}`,
        onRemove: () => setDeptFilter("all"),
      });
    }
    return filters;
  }, [searchQuery, statusFilter, deptFilter, deptLabelMap, statusMeta, t]);

  const visibleUsers = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return users;
    return users.filter((user) => {
      const department = user.deptId ? (deptLabelMap.get(user.deptId) ?? user.deptId) : "";
      return [user.id, user.email, user.displayName, department, user.jobTitle ?? ""]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query);
    });
  }, [deptLabelMap, searchQuery, users]);

  const viewSwitcher = (
    <div
      className="inline-flex items-center rounded-lg border border-border bg-muted/30 p-0.5"
      role="group"
      aria-label={t("view.switchLabel")}
    >
      <Button
        type="button"
        variant={viewMode === "list" ? "secondary" : "ghost"}
        size="sm"
        className="h-8 gap-1.5 px-2.5"
        aria-pressed={viewMode === "list"}
        onClick={() => setViewMode("list")}
      >
        <List />
        <span className="hidden sm:inline">{t("view.list")}</span>
      </Button>
      <Button
        type="button"
        variant={viewMode === "cards" ? "secondary" : "ghost"}
        size="sm"
        className="h-8 gap-1.5 px-2.5"
        aria-pressed={viewMode === "cards"}
        onClick={() => setViewMode("cards")}
      >
        <LayoutGrid />
        <span className="hidden sm:inline">{t("view.cards")}</span>
      </Button>
    </div>
  );

  const filtersToolbar = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
        <Input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="h-9"
        />
      </div>
      <Select
        value={statusFilter}
        onValueChange={(value) => {
          setPage(1);
          setStatusFilter(value as "all" | Status);
        }}
      >
        <SelectTrigger className="h-9 w-[140px]">
          <SelectValue placeholder={t("filterAllStatus")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("filterAllStatus")}</SelectItem>
          <SelectItem value="active">{t("status.active")}</SelectItem>
          <SelectItem value="disabled">{t("status.disabled")}</SelectItem>
          <SelectItem value="locked">{t("status.locked")}</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={deptFilter}
        onValueChange={(value) => {
          setPage(1);
          setDeptFilter(value);
        }}
      >
        <SelectTrigger className="h-9 w-[200px]">
          <SelectValue placeholder={t("filterAllDept")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("filterAllDept")}</SelectItem>
          {deptOptions.map((opt) => (
            <SelectItem key={opt.id} value={opt.id}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

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
              <BreadcrumbItem>{t("breadcrumbIam")}</BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{t("breadcrumbUsers")}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title={t("title")}
        description={t("description", { total, pageSize: PAGE_SIZE })}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCcw />
              {t("refresh")}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <UserPlus />
              {t("newUser")}
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="pt-5">
          {loading && users.length === 0 ? (
            <EmptyState
              icon={<Users className="h-5 w-5" />}
              title={t("loadingTitle")}
              description={t("loadingDescription")}
              size="sm"
              className="border-0"
            />
          ) : viewMode === "list" ? (
            <DataTable
              columns={columns}
              data={visibleUsers}
              enableGlobalFilter={false}
              activeFilters={activeFilters}
              onClearFilters={() => {
                setSearchQuery("");
                setStatusFilter("all");
                setDeptFilter("all");
                setPage(1);
              }}
              onRowClick={(row) => {
                setSelected(row.original);
                setEditOpen(true);
              }}
              toolbarLeft={filtersToolbar}
              toolbarRight={viewSwitcher}
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
                toast.success(t("toast.exportSuccess", { count: users.length }));
              }}
              getRowId={(row) => row.id}
            />
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {filtersToolbar}
                {viewSwitcher}
              </div>
              {activeFilters.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {activeFilters.map((filter) => (
                    <button
                      key={filter.id}
                      type="button"
                      className="rounded-full border border-border bg-muted/40 px-2.5 py-1 transition-colors hover:bg-muted"
                      onClick={filter.onRemove}
                    >
                      {filter.label} ×
                    </button>
                  ))}
                  <button
                    type="button"
                    className="px-2 py-1 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setSearchQuery("");
                      setStatusFilter("all");
                      setDeptFilter("all");
                      setPage(1);
                    }}
                  >
                    {t("clearFilters")}
                  </button>
                </div>
              ) : null}
              {visibleUsers.length === 0 ? (
                <EmptyState
                  icon={<Users className="h-5 w-5" />}
                  title={t("emptyTitle")}
                  description={t("emptyDescription")}
                  size="sm"
                  className="border-0"
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleUsers.map((user) => {
                    const meta = statusMeta[user.status];
                    const department = user.deptId
                      ? (deptLabelMap.get(user.deptId) ?? user.deptId)
                      : t("detail.unassigned");
                    return (
                      <Card
                        key={user.id}
                        className="cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/20"
                        onClick={() => {
                          setSelected(user);
                          setEditOpen(true);
                        }}
                      >
                        <CardContent className="space-y-3 p-4">
                          <div className="flex items-start gap-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
                              {user.displayName.slice(0, 1)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate font-medium">{user.displayName}</p>
                                <Badge variant={meta.variant}>{meta.label}</Badge>
                              </div>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">{user.email}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-lg bg-muted/40 px-2.5 py-2">
                              <p className="text-muted-foreground">{t("columns.department")}</p>
                              <p className="mt-0.5 truncate font-medium" title={department}>{department}</p>
                            </div>
                            <div className="rounded-lg bg-muted/40 px-2.5 py-2">
                              <p className="text-muted-foreground">{t("columns.scopeCount")}</p>
                              <p className="mt-0.5 font-medium">{user.scopes.length}</p>
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
                            <span className="truncate">{user.jobTitle || t("detail.noJobTitle")}</span>
                            <span className="shrink-0">{t("view.editHint")}</span>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2 text-sm text-muted-foreground">
        <span>
          {t("pagination.page", { page, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total })}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          {t("pagination.prev")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= Math.max(1, Math.ceil(total / PAGE_SIZE)) || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          {t("pagination.next")}
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
                <DetailRow label={t("detail.userId")} value={<span className="font-mono text-xs">{selected.id}</span>} />
                <DetailRow label={t("detail.tenant")} value={<span className="font-mono text-xs">{selected.tenantId}</span>} />
                <DetailRow
                  label={t("columns.department")}
                  value={
                    selected.deptId ? (deptLabelMap.get(selected.deptId) ?? selected.deptId) : "—"
                  }
                />
                <DetailRow label={t("detail.phone")} value={selected.phone ?? "—"} />
                <DetailRow label={t("detail.employeeNo")} value={selected.employeeNo ?? "—"} />
                <DetailRow label={t("detail.jobTitle")} value={selected.jobTitle ?? "—"} />
                <DetailRow
                  label={t("detail.roles")}
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
                  label={t("columns.status")}
                  value={<Badge variant={statusMeta[selected.status].variant}>{statusMeta[selected.status].label}</Badge>}
                />
                <DetailRow
                  label={t("detail.scopes")}
                  value={
                    <div className="flex flex-wrap gap-1">
                      {selected.scopes.length === 0 ? (
                        <span className="text-sm text-muted-foreground">{t("detail.none")}</span>
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
                  label={t("detail.createdAt")}
                  value={<span className="font-mono text-xs">{new Date(selected.createdAt).toLocaleString("zh-CN")}</span>}
                />
                <DetailRow
                  label={t("columns.updatedAt")}
                  value={<span className="font-mono text-xs">{new Date(selected.updatedAt).toLocaleString("zh-CN")}</span>}
                />

                {selected ? (
                  <VisibleModelsEditor
                    target={{
                      kind: "user",
                      id: selected.id,
                      deptId: selected.deptId ?? null,
                    }}
                    variant="inline"
                  />
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                <Button variant="outline" className="flex-1 min-w-[100px]" onClick={() => setEditOpen(true)}>
                  <Pencil />
                  {t("actions.edit")}
                </Button>
                <Button variant="outline" className="flex-1 min-w-[100px]" onClick={() => void handleResetPassword(selected)}>
                  {t("detail.resetPassword")}
                </Button>
                <Button
                  variant={selected.status === "active" ? "outline" : "default"}
                  className="flex-1"
                  onClick={() => void handleQuickToggleStatus(selected)}
                >
                  {selected.status === "active" ? <ShieldX /> : <ShieldCheck />}
                  {selected.status === "active" ? t("status.disabled") : t("status.active")}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void handleDelete(selected)}
                  disabled={selected.id === currentUserId}
                  title={selected.id === currentUserId ? "不能删除当前登录用户" : t("actions.delete")}
                >
                  <Trash2 />
                  {t("actions.delete")}
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* 新建 */}
      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("newUser")}
        description={t("form.createDescription")}
        defaultDeptId={initialDept === "all" ? undefined : initialDept}
        departmentOptions={deptOptions}
        onCreated={load}
      />

      {/* 编辑 */}
      <UserFormDialog
        open={editOpen && !!selected}
        onOpenChange={setEditOpen}
        title={t("form.editTitle")}
        description={selected?.email}
        submitLabel={t("form.submitSave")}
        roleOptions={roleOptions}
        deptOptions={deptOptions}
        initial={selectedInitial}
        onSubmit={async (values) => {
          if (!selected) return;
          const ok = await handleUpdate(selected.id, {
            email: values.email.trim(),
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

export default function UsersPage() {
  const t = useTranslations("pages.iam.users");
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">{t("suspenseLoading")}</div>}>
      <UsersPageContent />
    </Suspense>
  );
}
