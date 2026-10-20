"use client";
import { adminFetch } from "../../lib/admin-client-auth";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
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
import { MoreHorizontal, Pencil, Plus, ShieldCheck, ShieldX, Trash2, Users, Check } from "lucide-react";
import { LimitEditor } from "../quota/LimitEditor";
import { QuotaRing } from "../quota/QuotaRing";
import { VisibleModelsEditor } from "../visible-models-editor";

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

function getStatusMeta(t: ReturnType<typeof useTranslations<"pages.iam.users">>) {
  return {
    active: { label: t("status.active"), variant: "success" as const },
    disabled: { label: t("status.disabled"), variant: "warning" as const },
    locked: { label: t("status.locked"), variant: "destructive" as const },
  } satisfies Record<Status, { label: string; variant: "success" | "warning" | "destructive" }>;
}

type DeptOption = { id: string; label: string };
type RoleOption = { id: string; code: string; name: string };

const PAGE_SIZE = 50;
const UNASSIGNED_LIMIT = 200;
const MEMBERS_VIEW_KEY = "agx-admin-members-view";

type FeatureCount = {
  limit: number;
  used: number;
  remaining: number | null;
  window: "day" | "week" | "month" | null;
};

type MemberQuota = {
  userId: string;
  budget: {
    rule: { unit: "tokens" | "cost_usd"; period: "day" | "week" | "month"; limit: number } | null;
    source: "user" | "group" | "default" | "none";
    used: number;
    period: "day" | "week" | "month";
  };
  features: {
    search_provider_calls: FeatureCount;
    deep_research_runs: FeatureCount;
  };
};

const SOURCE_KEY = {
  user: "sourceUser",
  group: "sourceGroup",
  default: "sourceDefault",
  none: "sourceNone",
} as const;

export type MembersDeptFilter = string | "all" | "unassigned";

export function MembersRoster({
  deptId,
  createOpen,
  onCreateOpenChange,
  refreshKey = 0,
  focusUserId = null,
  onDeptIdChange,
  hideDeptFilter = false,
}: {
  deptId: MembersDeptFilter;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  refreshKey?: number;
  focusUserId?: string | null;
  onDeptIdChange?: (deptId: MembersDeptFilter) => void;
  /** 页面用左树传入 deptId 时隐藏名册内的部门下拉，避免两套筛选不同步。 */
  hideDeptFilter?: boolean;
}) {
  const t = useTranslations("pages.iam.users");
  const tm = useTranslations("pages.iam.members");
  const tl = useTranslations("pages.iam.limits");
  const statusMeta = useMemo(() => getStatusMeta(t), [t]);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const [deptFilter, setDeptFilter] = useState<MembersDeptFilter>(deptId);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deptOptions, setDeptOptions] = useState<DeptOption[]>([]);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [view, setView] = useState<"cards" | "list">("cards");
  const [overview, setOverview] = useState<Record<string, MemberQuota>>({});
  const [overviewNonce, setOverviewNonce] = useState(0);
  const [focusLimits, setFocusLimits] = useState(false);
  const limitsRef = useRef<HTMLDivElement>(null);

  const deptLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of deptOptions) m.set(d.id, d.label);
    return m;
  }, [deptOptions]);

  const activeDept = hideDeptFilter ? deptId : deptFilter;
  const unassignedView = activeDept === "unassigned";

  const applyDept = (value: MembersDeptFilter) => {
    setPage(1);
    setDeptFilter(value);
    onDeptIdChange?.(value);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (activeDept !== "all" && activeDept !== "unassigned") params.set("deptId", activeDept);
      params.set("limit", String(unassignedView ? UNASSIGNED_LIMIT : PAGE_SIZE));
      params.set("offset", String(unassignedView ? 0 : (page - 1) * PAGE_SIZE));
      const res = await fetch(`/api/admin/users?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as ApiListResp;
      if (res.ok && json.data) {
        const items = unassignedView ? json.data.items.filter((user) => !user.deptId) : json.data.items;
        setUsers(items);
        setTotal(unassignedView ? items.length : json.data.total);
      } else {
        toast.error(json.message ?? t("toast.loadFailed"));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.networkError"));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, activeDept, page, unassignedView, refreshKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setDeptFilter(deptId);
    setPage(1);
  }, [deptId]);

  const appliedUserRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusUserId) {
      appliedUserRef.current = null;
      return;
    }
    if (appliedUserRef.current === focusUserId) return;
    const local = users.find((user) => user.id === focusUserId);
    if (local) {
      appliedUserRef.current = focusUserId;
      setSelected(local);
      setEditOpen(false);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/admin/users/${focusUserId}`, { cache: "no-store" });
        const json = (await res.json()) as ApiUserResp;
        if (!alive || !res.ok || !json.data?.user) return;
        appliedUserRef.current = focusUserId;
        setSelected(json.data.user);
        setEditOpen(false);
      } catch {
        /* 列表仍可用 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [focusUserId, users]);

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
    const stored = window.localStorage.getItem(MEMBERS_VIEW_KEY);
    if (stored === "list" || stored === "cards") setView(stored);
  }, []);

  useEffect(() => {
    if (!selected || !focusLimits) return;
    const handle = window.setTimeout(() => limitsRef.current?.scrollIntoView({ block: "start" }), 50);
    return () => window.clearTimeout(handle);
  }, [selected, focusLimits]);

  useEffect(() => {
    if (users.length === 0) {
      setOverview({});
      return;
    }
    let alive = true;
    const ids = users.map((user) => user.id).join(",");
    void (async () => {
      try {
        const res = await adminFetch(`/api/admin/users/quota-overview?userIds=${encodeURIComponent(ids)}`, { cache: "no-store" });
        const json = (await res.json()) as { data?: { items?: MemberQuota[] } };
        if (!alive || !res.ok) return;
        const next: Record<string, MemberQuota> = {};
        for (const item of json.data?.items ?? []) next[item.userId] = item;
        setOverview(next);
      } catch {
        /* 卡片仍可打开详情 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [users, overviewNonce]);

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

  const handleCreate = async (input: Record<string, unknown>) => {
    const res = await adminFetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json()) as ApiUserResp;
    if (!res.ok || !json.data?.user) {
      toast.error(json.message ?? t("toast.createFailed"));
      return false;
    }
    toast.success(`${t("toast.created")} ${json.data.user.email}`);
    if (json.data.initialPassword) {
      toast.success(`${t("toast.initialPassword")}${json.data.initialPassword}`, { duration: 15_000 });
      try {
        await navigator.clipboard.writeText(json.data.initialPassword);
        toast.success(t("toast.passwordCopied"));
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
        cell: ({ row }) => {
          const label = row.original.deptId
            ? (deptLabelMap.get(row.original.deptId) ?? row.original.deptId)
            : "—";
          return (
            <span
              className="inline-block max-w-[240px] truncate whitespace-nowrap align-middle text-sm text-muted-foreground"
              title={row.original.deptId ? label : undefined}
            >
              {label}
            </span>
          );
        },
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
          <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
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
                    setEditOpen(true);
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  {t("actions.edit")}
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
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-danger focus:text-danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleDelete(row.original);
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("actions.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [selected?.id, deptLabelMap]
  );

  const activeFilters = useMemo(() => {
    const filters: Array<{ id: string; label: string; onRemove: () => void }> = [];
    if (statusFilter !== "all") {
      filters.push({
        id: "status",
        label: `${t("filterLabels.status")}${statusMeta[statusFilter].label}`,
        onRemove: () => setStatusFilter("all"),
      });
    }
    if (!hideDeptFilter && activeDept !== "all") {
      filters.push({
        id: "dept",
        label: `${t("filterLabels.department")}${
          activeDept === "unassigned" ? tm("unassigned") : (deptLabelMap.get(activeDept) ?? activeDept)
        }`,
        onRemove: () => applyDept("all"),
      });
    }
    return filters;
  }, [statusFilter, activeDept, deptLabelMap, statusMeta, t, tm, hideDeptFilter]);

  function chooseView(next: "cards" | "list") {
    setView(next);
    window.localStorage.setItem(MEMBERS_VIEW_KEY, next);
  }

  function featureText(name: string, count: FeatureCount | undefined) {
    if (!count || count.remaining == null) return `${name} · ${tm("featureOpen")}`;
    return `${name} · ${tm("featureRemaining", {
      window: count.window ? tl(`window.${count.window}`) : "",
      remaining: count.remaining,
      limit: count.limit,
    })}`;
  }

  function openMember(user: AdminUser, limits: boolean) {
    setSelected(user);
    setEditOpen(false);
    setFocusLimits(limits);
  }

  const filterControls = (
    <div className="flex flex-wrap gap-2">
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
      {hideDeptFilter ? null : (
        <Select value={deptFilter} onValueChange={(value) => applyDept(value)}>
          <SelectTrigger className="h-9 w-[200px]">
            <SelectValue placeholder={t("filterAllDept")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filterAllDept")}</SelectItem>
            <SelectItem value="unassigned">{tm("unassigned")}</SelectItem>
            {deptOptions.map((opt) => (
              <SelectItem key={opt.id} value={opt.id}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="pt-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            {filterControls}
            <div className="flex gap-1">
              <Button size="sm" variant={view === "cards" ? "default" : "outline"} onClick={() => chooseView("cards")}>
                {tm("viewCards")}
              </Button>
              <Button size="sm" variant={view === "list" ? "default" : "outline"} onClick={() => chooseView("list")}>
                {tm("viewList")}
              </Button>
            </div>
          </div>
          {loading && users.length === 0 ? (
            <EmptyState
              icon={<Users className="h-5 w-5" />}
              title={t("loadingTitle")}
              description={t("loadingDescription")}
              size="sm"
              className="border-0"
            />
          ) : view === "cards" ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {users.map((user) => {
                const item = overview[user.id];
                const rule = item?.budget.rule;
                return (
                  <div
                    key={user.id}
                    onClick={() => openMember(user, false)}
                    className="cursor-pointer rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40"
                  >
                    <div className="flex gap-3">
                      <QuotaRing
                        used={item?.budget.used ?? 0}
                        limit={rule?.limit ?? 0}
                        unlimited={!rule || rule.limit <= 0}
                        period={item?.budget.period ?? "month"}
                        unit={rule?.unit ?? "tokens"}
                        size={96}
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div>
                          <div className="truncate font-medium">{user.displayName}</div>
                          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                        </div>
                        <Badge variant="secondary">{tm(SOURCE_KEY[item?.budget.source ?? "none"])}</Badge>
                        <p className="text-xs text-muted-foreground">{featureText(tm("searchName"), item?.features.search_provider_calls)}</p>
                        <p className="text-xs text-muted-foreground">{featureText(tm("researchName"), item?.features.deep_research_runs)}</p>
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto px-0"
                          onClick={(event) => {
                            event.stopPropagation();
                            openMember(user, true);
                          }}
                        >
                          {tm("detailEdit")}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <DataTable
              className="min-w-0 [&_div:has(>table)]:overflow-x-auto [&_table]:min-w-[840px] [&_th]:whitespace-nowrap"
              columns={columns}
              data={users}
              searchPlaceholder={t("searchPlaceholder")}
              activeFilters={activeFilters}
              onClearFilters={() => {
                setStatusFilter("all");
                applyDept("all");
              }}
              onRowClick={(row) => openMember(row.original, false)}
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
          )}
        </CardContent>
      </Card>

      {unassignedView ? (
        <p className="text-right text-xs text-muted-foreground">{tm("unassignedLimitHint")}</p>
      ) : (
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
      )}

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
                <div ref={limitsRef} className="space-y-2 border-t border-border pt-4">
                  <h3 className="text-sm font-medium">{tm("usageLimits")}</h3>
                  <p className="text-xs leading-5 text-muted-foreground">{tm("usageLimitsHint")}</p>
                  <LimitEditor
                    key={selected.id}
                    scope="users"
                    id={selected.id}
                    onSaved={() => setOverviewNonce((value) => value + 1)}
                  />
                </div>
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
        onOpenChange={onCreateOpenChange}
        title={t("newUser")}
        description={t("form.createDescription")}
        submitLabel={t("form.submitCreate")}
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
          if (ok) onCreateOpenChange(false);
        }}
      />

      {/* 编辑 */}
      <UserFormDialog
        open={editOpen && !!selected}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setSelected(selected);
        }}
        title={t("form.editTitle")}
        description={selected?.email}
        submitLabel={t("form.submitSave")}
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
  const t = useTranslations("pages.iam.users");
  const tc = useTranslations("common");
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
            <Label htmlFor="user-email">{t("form.emailLabel")}</Label>
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
            <Label htmlFor="user-name">{t("form.nameLabel")}</Label>
            <Input
              id="user-name"
              required
              value={values.displayName}
              onChange={(event) => setValues((prev) => ({ ...prev, displayName: event.target.value }))}
              placeholder={t("form.namePlaceholder")}
            />
          </div>
            <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("columns.status")}</Label>
              <Select
                value={values.status}
                onValueChange={(value) => setValues((prev) => ({ ...prev, status: value as Status }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("status.active")}</SelectItem>
                  <SelectItem value="disabled">{t("status.disabled")}</SelectItem>
                  <SelectItem value="locked">{t("status.locked")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("columns.department")}</Label>
              <Select
                value={values.deptId || "__none__"}
                onValueChange={(v) => setValues((prev) => ({ ...prev, deptId: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("form.deptPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("form.deptUnassigned")}</SelectItem>
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
              <Label htmlFor="user-phone">{t("detail.phone")}</Label>
              <Input
                id="user-phone"
                value={values.phone}
                onChange={(e) => setValues((prev) => ({ ...prev, phone: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-eno">{t("detail.employeeNo")}</Label>
              <Input
                id="user-eno"
                value={values.employeeNo}
                onChange={(e) => setValues((prev) => ({ ...prev, employeeNo: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-job">{t("detail.jobTitle")}</Label>
            <Input
              id="user-job"
              value={values.jobTitle}
              onChange={(e) => setValues((prev) => ({ ...prev, jobTitle: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("detail.roles")}</Label>
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
              <Label htmlFor="user-init-pw">{t("form.initialPasswordLabel")}</Label>
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
              {tc("actions.cancel")}
            </Button>
            <Button type="submit" disabled={submitting}>
              <Plus />
              {submitting ? t("form.processing") : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
