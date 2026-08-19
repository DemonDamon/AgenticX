"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Sheet,
  SheetContent,
  SheetTitle,
  Skeleton,
  toast,
} from "@agenticx/ui";
import {
  LayoutGrid,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  UsersRound,
} from "lucide-react";
import { adminFetch } from "../../../lib/admin-client-auth";
import { CreateUserDialog } from "../../../components/CreateUserDialog";
import { QuotaRing, formatTokenCount } from "../../../components/QuotaRing";
import {
  UserDetailEditor,
  type UserDetailOverview,
} from "../../../components/UserDetailEditor";
import {
  ALL_DEPARTMENTS,
  DepartmentFilterTree,
  NO_DEPARTMENT,
  departmentSubtreeIds,
  type DepartmentFilter,
  type OrganizationNode,
} from "../../../components/DepartmentFilterTree";
import { VisibleModelsEditor } from "../../../components/visible-models-editor";

type GrantSource = "personal" | "group" | "department" | "all";
type GrantOrigin = { source?: GrantSource; sourceLabel?: string };
type UserModelSummary = {
  model: string;
  tokens: number;
  currentlyAllowed: boolean;
} & GrantOrigin;
type UserPackSummary = { id: string; name: string } & GrantOrigin;
type UserFeatureSummary = { enabled: boolean } & GrantOrigin;
// Omit 掉 models：UserDetailEditor 里另有一个不带来源的同名类型，直接交叉会打架。
type UserQuotaOverview = Omit<UserDetailOverview, "models"> & {
  models: UserModelSummary[];
  packs?: UserPackSummary[];
  features?: { webSearch: UserFeatureSummary; deepResearch: UserFeatureSummary };
};
type ApiEnvelope<T> = { code: string; message: string; data?: T };

/**
 * 来源短标。卡片的意义就在这一句：同样是「能用 Claude」，继承来的和单独特批的，
 * 管理员要做的事完全不同——前者改组就动了一片人，后者只动他一个。
 */
function grantSourceText(origin: GrantOrigin): string {
  switch (origin.source) {
    case "personal":
      return "特批";
    case "group":
      return origin.sourceLabel ? `继承自 ${origin.sourceLabel}` : "继承自用户组";
    case "department":
      return origin.sourceLabel ? `继承自 ${origin.sourceLabel}` : "部门继承";
    case "all":
      return "全员";
    default:
      return "";
  }
}

function quotaSourceLabel(user: UserQuotaOverview): string {
  if (user.quotaSource === "group") return user.quotaSourceLabel ? `继承自 ${user.quotaSourceLabel}` : "继承自用户组";
  if (user.quotaSource === "personal") return "个人设置";
  return "默认设置";
}

function modelQuotaStateClass(
  user: Pick<UserQuotaOverview, "usedTokens" | "monthlyTokens" | "unlimited">,
  model: UserModelSummary,
): string {
  if (!model.currentlyAllowed) return "border-border bg-muted/30 text-muted-foreground";
  if (user.unlimited || user.monthlyTokens <= 0) return "border-border bg-background text-foreground";
  const ratio = user.usedTokens / user.monthlyTokens;
  if (ratio >= 1) return "border-destructive/50 bg-destructive/10 text-destructive";
  if (ratio >= 0.8) return "border-amber-400/70 bg-amber-300/30 text-amber-950 dark:border-amber-300/50 dark:bg-amber-400/20 dark:text-amber-100";
  return "border-border bg-background text-foreground";
}

function userStatusMeta(status: UserQuotaOverview["status"]) {
  if (status === "active") return { label: "启用", variant: "success" as const };
  if (status === "locked") return { label: "锁定", variant: "destructive" as const };
  return { label: "停用", variant: "warning" as const };
}

export default function RolesPage() {
  const searchParams = useSearchParams();
  const requestedDeptId = searchParams.get("dept")?.trim() ?? "";
  const createRequested = searchParams.get("create") === "1";
  const [items, setItems] = useState<UserQuotaOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<UserQuotaOverview | null>(null);
  const [createOpen, setCreateOpen] = useState(createRequested);
  const [viewMode, setViewMode] = useState<"cards" | "list">("cards");
  const [viewModeHydrated, setViewModeHydrated] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [organization, setOrganization] = useState<OrganizationNode[]>([]);
  // ?dept= 是从别的页面跳过来时带的定位参数，作为初值；之后由左栏树接管。
  const [deptFilter, setDeptFilter] = useState<DepartmentFilter>(
    requestedDeptId || ALL_DEPARTMENTS,
  );
  const [ceilingTarget, setCeilingTarget] = useState<OrganizationNode | null>(null);
  const openedFromQueryRef = useRef<string | null>(null);

  useEffect(() => {
    const savedViewMode = window.localStorage.getItem("admin-iam-user-view-mode");
    if (savedViewMode === "cards" || savedViewMode === "list") setViewMode(savedViewMode);
    setViewModeHydrated(true);
  }, []);

  useEffect(() => {
    if (viewModeHydrated) window.localStorage.setItem("admin-iam-user-view-mode", viewMode);
  }, [viewMode, viewModeHydrated]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminFetch("/api/admin/users/quota-overview", { cache: "no-store" });
      const json = (await response.json()) as ApiEnvelope<{
        items: UserQuotaOverview[];
        organization: OrganizationNode[];
      }>;
      if (!response.ok || json.code !== "00000") throw new Error(json.message || "加载用户失败");
      setItems(json.data?.items ?? []);
      setOrganization(json.data?.organization ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载用户失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const openEditor = useCallback((user: UserQuotaOverview) => {
    setSelected(user);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const userId = searchParams.get("user");
    if (!userId || loading || openedFromQueryRef.current === userId) return;
    const user = items.find((item) => item.id === userId);
    if (!user) return;
    openedFromQueryRef.current = userId;
    openEditor(user);
  }, [items, loading, openEditor, searchParams]);

  useEffect(() => {
    if (createRequested) setCreateOpen(true);
  }, [createRequested]);

  // 选中一个部门时子部门的人也算进来：点「研发中心」要看的是整棵子树。
  const deptScope = useMemo(
    () =>
      deptFilter === ALL_DEPARTMENTS || deptFilter === NO_DEPARTMENT
        ? null
        : departmentSubtreeIds(organization, deptFilter),
    [organization, deptFilter],
  );

  const visibleItems = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return items.filter((user) => {
      if (deptFilter === NO_DEPARTMENT && user.deptId) return false;
      if (deptScope && !(user.deptId && deptScope.has(user.deptId))) return false;
      if (!query) return true;
      return [
          user.displayName,
          user.email,
          user.departmentName,
          user.departmentPath,
          user.jobTitle,
          user.employeeNo,
          user.phone,
          ...user.groupNames,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(query);
    });
  }, [items, deptFilter, deptScope, searchQuery]);

  const toolbarButtonClass =
    "h-10 !rounded-xl shadow-sm focus-visible:!rounded-xl focus-visible:!outline-none focus-visible:ring-0";
  const viewSwitcherButtonClass =
    "h-9 !rounded-lg gap-1.5 px-2.5 focus-visible:!rounded-lg focus-visible:!outline-none focus-visible:ring-0";

  const viewSwitcher = (
    <div
      className="inline-flex h-10 shrink-0 items-center rounded-xl border border-border/80 bg-background/95 p-0.5 shadow-sm"
      role="group"
      aria-label="切换用户视图"
    >
      <Button
        type="button"
        variant={viewMode === "cards" ? "secondary" : "ghost"}
        size="sm"
        className={viewSwitcherButtonClass}
        aria-pressed={viewMode === "cards"}
        onClick={() => setViewMode("cards")}
      >
        <LayoutGrid />
        <span className="hidden sm:inline">卡片</span>
      </Button>
      <Button
        type="button"
        variant={viewMode === "list" ? "secondary" : "ghost"}
        size="sm"
        className={viewSwitcherButtonClass}
        aria-pressed={viewMode === "list"}
        onClick={() => setViewMode("list")}
      >
        <List />
        <span className="hidden sm:inline">列表</span>
      </Button>
    </div>
  );
  const userListGridClass = "grid min-w-[1160px] grid-cols-[minmax(240px,1.55fr)_minmax(220px,1.25fr)_88px_minmax(160px,1fr)_minmax(180px,1.3fr)_148px] items-center gap-4";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">成员独立计量与模型范围</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">用户</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            每位用户都有独立的 Token 额度、消耗记录和可用模型。用户组提供批量基线，个人可在此基础上调整额度并额外开通模型。
          </p>
        </div>
        <div className="flex shrink-0 flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap">
          <Button
            className={`${toolbarButtonClass} px-5`}
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" />新建用户
          </Button>
          <div className="relative shrink-0 rounded-xl transition-shadow focus-within:shadow-[0_0_0_2px_var(--primary)]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              name="iam-user-search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索姓名、邮箱、组织"
              aria-label="搜索用户"
              className="h-10 w-60 appearance-none !rounded-xl border-border/80 bg-background/95 pl-9 shadow-sm transition-colors placeholder:text-muted-foreground/70 !outline-none focus-visible:border-border/80 focus-visible:!rounded-xl focus-visible:!outline-none focus-visible:ring-0"
            />
          </div>
          {viewSwitcher}
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={`${toolbarButtonClass} w-10 shrink-0`}
            aria-label="刷新用量"
            title="刷新用量"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <aside className="shrink-0 rounded-xl border border-border bg-card p-2 lg:sticky lg:top-4 lg:w-60">
          <DepartmentFilterTree
            nodes={organization}
            selected={deptFilter}
            onSelect={setDeptFilter}
            onConfigureModels={setCeilingTarget}
            totalCount={items.length}
            unassignedCount={items.filter((user) => !user.deptId).length}
          />
        </aside>
        <div className="min-w-0 flex-1">
      {viewMode === "cards" ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {loading && items.length === 0
            ? [1, 2, 3, 4, 5, 6].map((key) => (
                <Card key={key} className="min-h-64">
                  <CardHeader><Skeleton className="h-6 w-36" /><Skeleton className="h-4 w-48" /></CardHeader>
                  <CardContent className="flex gap-5"><Skeleton className="h-28 w-28 rounded-full" /><Skeleton className="h-24 flex-1" /></CardContent>
                </Card>
              ))
            : null}
          {!loading && items.length === 0 ? (
            <Card className="border-dashed md:col-span-2 2xl:col-span-3">
              <CardContent className="flex min-h-64 flex-col items-center justify-center text-center">
                <span className="rounded-full bg-primary/10 p-3 text-primary"><UsersRound className="h-6 w-6" /></span>
                <h2 className="mt-4 font-semibold">暂无用户</h2>
                <p className="mt-1 text-sm text-muted-foreground">开通用户后会在这里显示每个人的额度、模型和使用情况。</p>
              </CardContent>
            </Card>
          ) : null}
          {!loading && items.length > 0 && visibleItems.length === 0 ? (
            <Card className="border-dashed md:col-span-2 2xl:col-span-3">
              <CardContent className="flex min-h-48 flex-col items-center justify-center text-center">
                <Search className="h-6 w-6 text-muted-foreground" />
                <h2 className="mt-4 font-semibold">未找到匹配用户</h2>
                <p className="mt-1 text-sm text-muted-foreground">请尝试姓名、邮箱、组织或职位关键词。</p>
              </CardContent>
            </Card>
          ) : null}
          {visibleItems.map((user) => {
            const status = userStatusMeta(user.status);
            return (
              <Card
                key={user.id}
                className="group cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/20"
                onClick={() => void openEditor(user)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{user.displayName}</CardTitle>
                      <CardDescription className="mt-1 truncate">{user.email}</CardDescription>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {user.departmentPath || user.departmentName || "未归属组织"}{user.jobTitle ? ` · ${user.jobTitle}` : ""}
                      </p>
                    </div>
                    <div className="flex max-w-44 shrink-0 flex-wrap justify-end gap-1.5">
                      <Badge variant={status.variant}>{status.label}</Badge>
                      <Badge variant={user.inherited ? "secondary" : "outline"} className="truncate">
                        {quotaSourceLabel(user)}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4">
                    <QuotaRing used={user.usedTokens} limit={user.monthlyTokens} unlimited={user.unlimited} size={112} />
                    <div className="min-w-0 space-y-2 text-sm">
                      <p className="text-muted-foreground">本月个人额度</p>
                      <p className="font-semibold">{user.unlimited ? "不限制" : `${formatTokenCount(user.monthlyTokens)} Token`}</p>
                      <p className="text-xs text-muted-foreground">已用 {formatTokenCount(user.usedTokens)} Token</p>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        onClick={(event) => {
                          event.stopPropagation();
                          void openEditor(user);
                        }}
                      >
                        <Pencil className="h-3 w-3" />详细编辑
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2 border-t border-border pt-3">
                    <div className="flex flex-wrap gap-1.5">
                      {user.groupNames.length
                        ? user.groupNames.map((name) => <Badge key={name} variant="outline" className="font-normal">{name}</Badge>)
                        : <span className="text-xs text-muted-foreground">未加入用户组</span>}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {user.models.length
                        ? user.models.map((model) => (
                            <Badge
                              key={`${model.model}:${model.currentlyAllowed}`}
                              variant="outline"
                              title={model.currentlyAllowed ? "当前可用模型" : "历史消耗模型，当前不可用"}
                              className={`max-w-full truncate font-normal ${modelQuotaStateClass(user, model)}`}
                            >
                              {model.model}
                              {model.tokens > 0 ? ` · ${formatTokenCount(model.tokens)}` : ""}
                              {model.currentlyAllowed
                                ? grantSourceText(model)
                                  ? ` · ${grantSourceText(model)}`
                                  : ""
                                : " · 当前不可用"}
                            </Badge>
                          ))
                        : <span className="text-xs text-muted-foreground">当前未开通模型</span>}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {user.packs?.length
                        ? user.packs.map((pack) => (
                            <Badge key={pack.id} variant="outline" className="max-w-full truncate font-normal">
                              {pack.name}
                              {grantSourceText(pack) ? ` · ${grantSourceText(pack)}` : ""}
                            </Badge>
                          ))
                        : <span className="text-xs text-muted-foreground">未分配能力包</span>}
                    </div>
                    {user.features ? (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {([
                          ["联网搜索", user.features.webSearch],
                          ["深度研究", user.features.deepResearch],
                        ] as const).map(([label, feature]) => (
                          <span key={label}>
                            {label}
                            <span className={feature.enabled ? "ml-1 text-foreground" : "ml-1"}>
                              {feature.enabled ? "已开通" : "未开通"}
                            </span>
                            {feature.enabled && grantSourceText(feature)
                              ? `（${grantSourceText(feature)}）`
                              : ""}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {loading && items.length === 0 ? (
            <div className="space-y-3 p-4">
              {[1, 2, 3, 4].map((key) => <Skeleton key={key} className="h-16 w-full" />)}
            </div>
          ) : items.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center text-center">
              <span className="rounded-full bg-primary/10 p-3 text-primary"><UsersRound className="h-6 w-6" /></span>
              <h2 className="mt-4 font-semibold">暂无用户</h2>
              <p className="mt-1 text-sm text-muted-foreground">开通用户后会在这里显示每个人的额度、模型和使用情况。</p>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center text-center">
              <Search className="h-6 w-6 text-muted-foreground" />
              <h2 className="mt-4 font-semibold">未找到匹配用户</h2>
              <p className="mt-1 text-sm text-muted-foreground">请尝试姓名、邮箱、组织或职位关键词。</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[1160px]">
                <div className={`${userListGridClass} border-b border-border bg-muted/20 px-4 py-3 text-xs font-medium text-muted-foreground`} role="row">
                  <div role="columnheader">用户</div>
                  <div role="columnheader">组织与职位</div>
                  <div role="columnheader">状态</div>
                  <div role="columnheader">Token 额度</div>
                  <div role="columnheader">可用模型</div>
                  <div role="columnheader" className="text-right">操作</div>
                </div>
                <div className="divide-y divide-border">
                  {visibleItems.map((user) => {
                    const status = userStatusMeta(user.status);
                    return (
                      <div
                        key={user.id}
                        role="button"
                        tabIndex={0}
                        className={`${userListGridClass} cursor-pointer px-4 py-3 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset`}
                        onClick={() => void openEditor(user)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void openEditor(user);
                          }
                        }}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                            {user.displayName.slice(0, 1)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{user.displayName}</p>
                            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                          </div>
                        </div>
                        <div className="min-w-0 text-sm">
                          <p className="truncate">{user.departmentPath || user.departmentName || "未归属组织"}</p>
                          <p className="truncate text-xs text-muted-foreground">{user.jobTitle || "未填写职位"}</p>
                        </div>
                        <Badge variant={status.variant} className="justify-self-start">{status.label}</Badge>
                        <div className="min-w-0 text-sm">
                          <p className="truncate font-medium">{user.unlimited ? "不限制" : `${formatTokenCount(user.monthlyTokens)} Token`}</p>
                          <p className="truncate text-xs text-muted-foreground">已用 {formatTokenCount(user.usedTokens)}</p>
                        </div>
                        <div className="flex min-w-0 flex-wrap gap-1">
                          {user.models.length ? user.models.slice(0, 3).map((model) => (
                            <Badge key={`${user.id}:${model.model}`} variant="outline" className="max-w-full truncate text-xs">
                              {model.model}
                            </Badge>
                          )) : <span className="text-xs text-muted-foreground">未开通模型</span>}
                          {user.models.length > 3 ? <Badge variant="outline">+{user.models.length - 3}</Badge> : null}
                        </div>
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={(event) => {
                              event.stopPropagation();
                              void openEditor(user);
                            }}
                          >
                            <Pencil />详细编辑
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
        </div>
      </div>

      {/* 部门模型天花板：部门管理不再占一级菜单，但天花板必须有地方配——挂在筛选树上。 */}
      <Sheet open={ceilingTarget !== null} onOpenChange={(open) => !open && setCeilingTarget(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl">
          <SheetTitle>{ceilingTarget ? `${ceilingTarget.name} · 模型上限` : "模型上限"}</SheetTitle>
          {ceilingTarget ? (
            <div className="pt-4">
              <VisibleModelsEditor
                target={{ kind: "dept", id: ceilingTarget.id }}
                variant="sheet"
                onClose={() => setCeilingTarget(null)}
                onSaved={load}
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <UserDetailEditor
        target={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onChanged={load}
      />

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultDeptId={requestedDeptId || undefined}
        onCreated={load}
      />
    </div>
  );
}
