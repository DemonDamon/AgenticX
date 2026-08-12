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
  Checkbox,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  toast,
} from "@agenticx/ui";
import {
  Copy,
  KeyRound,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UsersRound,
} from "lucide-react";
import { adminFetch } from "../../../lib/admin-client-auth";
import { CreateUserDialog } from "../../../components/CreateUserDialog";
import { QuotaRing, formatTokenCount } from "../../../components/QuotaRing";
import {
  UserFormFields,
  type UserFormDeptOption,
  type UserFormRoleOption,
  type UserFormValues,
} from "../../../components/UserFormDialog";

type UserModelSummary = { model: string; tokens: number; currentlyAllowed: boolean };
type UserQuotaOverview = {
  id: string;
  displayName: string;
  email: string;
  deptId: string | null;
  departmentName?: string;
  departmentPath?: string;
  status: "active" | "disabled" | "locked";
  phone: string | null;
  employeeNo: string | null;
  jobTitle: string | null;
  usedTokens: number;
  monthlyTokens: number;
  unlimited: boolean;
  inherited: boolean;
  quotaSource: "group" | "personal" | "default";
  quotaSourceLabel?: string;
  groupNames: string[];
  models: UserModelSummary[];
};
type ModelOption = { id: string; providerLabel: string; label: string };
type ModelAccess = {
  parentAllowedIds: string[];
  individualModelIds?: string[];
  groupModelIds?: string[];
  excludedGroupModelIds?: string[];
  groupModelSources?: Array<{ id: string; name: string; modelIds: string[] }>;
  effectiveModelIds?: string[];
};
type ApiEnvelope<T> = { code: string; message: string; data?: T };
type EditableUser = {
  id: string;
  email: string;
  displayName: string;
  status: "active" | "disabled" | "locked";
  deptId: string | null;
  phone: string | null;
  employeeNo: string | null;
  jobTitle: string | null;
  roleCodes: string[];
};
function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
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
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<UserQuotaOverview | null>(null);
  const [monthlyTokens, setMonthlyTokens] = useState("");
  const [unlimitedTokens, setUnlimitedTokens] = useState(false);
  const [finiteMonthlyTokens, setFiniteMonthlyTokens] = useState("");
  const [modelAccess, setModelAccess] = useState<ModelAccess | null>(null);
  const [manualModelIds, setManualModelIds] = useState<string[]>([]);
  const [initialManualModelIds, setInitialManualModelIds] = useState<string[]>([]);
  const [excludedGroupModelIds, setExcludedGroupModelIds] = useState<string[]>([]);
  const [initialExcludedGroupModelIds, setInitialExcludedGroupModelIds] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetPasswordPending, setResetPasswordPending] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(createRequested);
  const [userFormLoading, setUserFormLoading] = useState(false);
  const [userFormInitial, setUserFormInitial] = useState<UserFormValues | null>(null);
  const [userFormDeptOptions, setUserFormDeptOptions] = useState<UserFormDeptOption[]>([]);
  const [userFormRoleOptions, setUserFormRoleOptions] = useState<UserFormRoleOption[]>([]);
  const [viewMode, setViewMode] = useState<"cards" | "list">("cards");
  const [viewModeHydrated, setViewModeHydrated] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
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
      const json = (await response.json()) as ApiEnvelope<{ items: UserQuotaOverview[] }>;
      if (!response.ok || json.code !== "00000") throw new Error(json.message || "加载用户失败");
      setItems(json.data?.items ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载用户失败");
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

  const openEditor = useCallback(async (user: UserQuotaOverview) => {
    setSelected(user);
    const userHasNoLimit = user.unlimited || user.monthlyTokens <= 0;
    const initialMonthlyTokens = userHasNoLimit ? "0" : String(user.monthlyTokens);
    setUnlimitedTokens(userHasNoLimit);
    setMonthlyTokens(initialMonthlyTokens);
    setFiniteMonthlyTokens(userHasNoLimit ? "" : initialMonthlyTokens);
    setModelAccess(null);
    setManualModelIds([]);
    setInitialManualModelIds([]);
    setExcludedGroupModelIds([]);
    setInitialExcludedGroupModelIds([]);
    setResetPasswordPending(false);
    setNewPassword(null);
    setUserFormInitial(null);
    setUserFormDeptOptions([]);
    setUserFormRoleOptions([]);
    setLoadingModels(true);
    setUserFormLoading(true);
    try {
      const [modelResponse, userResponse, departmentResponse, roleResponse] = await Promise.all([
        adminFetch(`/api/admin/users/${encodeURIComponent(user.id)}/models`, { cache: "no-store" }),
        adminFetch(`/api/admin/users/${encodeURIComponent(user.id)}`, { cache: "no-store" }),
        adminFetch("/api/admin/departments?shape=flat", { cache: "no-store" }),
        adminFetch("/api/admin/roles", { cache: "no-store" }),
      ]);
      const [modelJson, userJson, departmentJson, roleJson] = await Promise.all([
        modelResponse.json() as Promise<ApiEnvelope<ModelAccess>>,
        userResponse.json() as Promise<ApiEnvelope<{ user: EditableUser }>>,
        departmentResponse.json() as Promise<ApiEnvelope<{ items: Array<{ id: string; name: string; path: string }> }>>,
        roleResponse.json() as Promise<ApiEnvelope<{ items: UserFormRoleOption[] }>>,
      ]);
      if (!userResponse.ok || userJson.code !== "00000" || !userJson.data?.user) {
        throw new Error(userJson.message || "加载用户信息失败");
      }
      if (!departmentResponse.ok || departmentJson.code !== "00000") {
        throw new Error(departmentJson.message || "加载部门失败");
      }
      if (!roleResponse.ok || roleJson.code !== "00000") {
        throw new Error(roleJson.message || "加载角色失败");
      }

      const editableUser = userJson.data.user;
      setUserFormInitial({
        email: editableUser.email,
        displayName: editableUser.displayName,
        status: editableUser.status,
        deptId: editableUser.deptId ?? "",
        phone: editableUser.phone ?? "",
        employeeNo: editableUser.employeeNo ?? "",
        jobTitle: editableUser.jobTitle ?? "",
        roleCodes: editableUser.roleCodes.length ? editableUser.roleCodes : ["member"],
        initialPassword: "",
      });
      setUserFormDeptOptions(
        (departmentJson.data?.items ?? []).map((department) => ({
          id: department.id,
          label: `${department.name}（${department.path}）`,
        })),
      );
      setUserFormRoleOptions(roleJson.data?.items ?? []);

      if (!modelResponse.ok || modelJson.code !== "00000" || !modelJson.data) {
        toast.error(modelJson.message || "加载可用模型失败");
        return;
      }

      const groupModelIds = new Set(modelJson.data.groupModelIds ?? []);
      const individualModelIds = (modelJson.data.individualModelIds ?? []).filter((modelId) => !groupModelIds.has(modelId));
      setModelAccess(modelJson.data);
      setManualModelIds(individualModelIds);
      setInitialManualModelIds(individualModelIds);
      const excludedIds = modelJson.data.excludedGroupModelIds ?? [];
      setExcludedGroupModelIds(excludedIds);
      setInitialExcludedGroupModelIds(excludedIds);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载用户详细信息失败");
    } finally {
      setLoadingModels(false);
      setUserFormLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadModelOptions();
  }, [load, loadModelOptions]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await adminFetch("/api/auth/session", { cache: "no-store" });
        const json = (await response.json()) as { data?: { userId?: string } };
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
    const userId = searchParams.get("user");
    if (!userId || loading || openedFromQueryRef.current === userId) return;
    const user = items.find((item) => item.id === userId);
    if (!user) return;
    openedFromQueryRef.current = userId;
    void openEditor(user);
  }, [items, loading, openEditor, searchParams]);

  useEffect(() => {
    if (createRequested) setCreateOpen(true);
  }, [createRequested]);

  const groupModelIdSet = useMemo(() => new Set(modelAccess?.groupModelIds ?? []), [modelAccess]);
  const excludedGroupModelIdSet = useMemo(() => new Set(excludedGroupModelIds), [excludedGroupModelIds]);
  const parentAllowedModelIdSet = useMemo(() => new Set(modelAccess?.parentAllowedIds ?? []), [modelAccess]);
  const visibleModelIds = useMemo(() => {
    if (!modelAccess) return new Set<string>();
    if (groupModelIdSet.size > 0) {
      return new Set([
        ...(modelAccess.groupModelIds ?? []).filter((modelId) => !excludedGroupModelIdSet.has(modelId)),
        ...manualModelIds,
      ]);
    }
    if (manualModelIds.length > 0) return new Set(manualModelIds);
    return new Set(modelAccess.parentAllowedIds);
  }, [excludedGroupModelIdSet, groupModelIdSet, manualModelIds, modelAccess]);

  const toggleModel = (modelId: string) => {
    if (!modelAccess || !parentAllowedModelIdSet.has(modelId)) return;
    if (groupModelIdSet.has(modelId)) {
      setExcludedGroupModelIds((current) =>
        current.includes(modelId) ? current.filter((id) => id !== modelId) : [...current, modelId],
      );
      return;
    }
    setManualModelIds((current) => {
      const next = new Set(current);
      if (next.size === 0 && groupModelIdSet.size === 0) {
        for (const id of modelAccess.effectiveModelIds ?? modelAccess.parentAllowedIds) next.add(id);
      }
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return [...next];
    });
  };

  const setQuotaUnlimited = (next: boolean) => {
    if (next) {
      const currentFiniteValue = Number(monthlyTokens) > 0 ? monthlyTokens : "";
      setFiniteMonthlyTokens((current) => current || currentFiniteValue);
      setMonthlyTokens("0");
    } else {
      setMonthlyTokens(finiteMonthlyTokens);
    }
    setUnlimitedTokens(next);
  };

  const save = async () => {
    if (!selected || !userFormInitial || saving || userFormLoading) return;
    if (!userFormInitial.email.trim() || !userFormInitial.displayName.trim()) {
      toast.error("请填写邮箱和姓名");
      return;
    }
    const nextQuota = unlimitedTokens ? 0 : Number(monthlyTokens);
    if (!unlimitedTokens && (!Number.isInteger(nextQuota) || nextQuota <= 0)) {
      toast.error("请关闭不限额后输入正整数 Token 额度");
      return;
    }
    const quotaChanged = Math.floor(nextQuota) !== selected.monthlyTokens;
    const modelsChanged =
      !sameIds(manualModelIds, initialManualModelIds) ||
      !sameIds(excludedGroupModelIds, initialExcludedGroupModelIds);
    setSaving(true);
    try {
      const requests: Promise<Response>[] = [
        adminFetch(`/api/admin/users/${encodeURIComponent(selected.id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: userFormInitial.email.trim(),
            displayName: userFormInitial.displayName.trim(),
            status: userFormInitial.status,
            deptId: userFormInitial.deptId || null,
            phone: userFormInitial.phone.trim() || null,
            employeeNo: userFormInitial.employeeNo.trim() || null,
            jobTitle: userFormInitial.jobTitle.trim() || null,
            roleCodes: userFormInitial.roleCodes.length ? userFormInitial.roleCodes : ["member"],
          }),
        }),
      ];
      if (quotaChanged) {
        requests.push(
          adminFetch(`/api/admin/users/${selected.id}/quota`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ monthlyTokens: Math.floor(nextQuota) }),
          }),
        );
      }
      if (modelsChanged) {
        requests.push(
          adminFetch(`/api/admin/users/${selected.id}/models`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ modelIds: manualModelIds, excludedGroupModelIds }),
          }),
        );
      }
      const responses = await Promise.all(requests);
      for (const response of responses) {
        const json = (await response.json()) as ApiEnvelope<unknown>;
        if (!response.ok || json.code !== "00000") throw new Error(json.message || "保存失败");
      }
      toast.success("用户详细信息已保存");
      setSelected(null);
      setUserFormInitial(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const restoreInheritedQuota = async () => {
    if (!selected || saving || selected.quotaSource !== "personal") return;
    setSaving(true);
    try {
      const response = await adminFetch(`/api/admin/users/${selected.id}/quota`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inherit: true }),
      });
      const json = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || json.code !== "00000") throw new Error(json.message || "恢复继承额度失败");
      toast.success("已恢复继承额度");
      setSelected(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "恢复继承额度失败");
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async () => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const response = await adminFetch(`/api/admin/users/${selected.id}/reset-password`, { method: "POST" });
      const json = (await response.json()) as ApiEnvelope<{ initialPassword?: string }>;
      if (!response.ok || !json.data?.initialPassword) throw new Error(json.message || "重置密码失败");
      setNewPassword(json.data.initialPassword);
      setResetPasswordPending(false);
      toast.success("已生成新的登录密码");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重置密码失败");
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async () => {
    if (!selected || saving) return;
    if (selected.id === currentUserId) {
      toast.error("不能删除当前登录用户");
      return;
    }
    if (!window.confirm(`确认删除用户 ${selected.email}？该操作不可撤销。`)) return;
    setSaving(true);
    try {
      const response = await adminFetch(`/api/admin/users/${selected.id}`, { method: "DELETE" });
      const json = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || json.code !== "00000") throw new Error(json.message || "删除用户失败");
      toast.success(`用户已删除：${selected.email}`);
      setSelected(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除用户失败");
    } finally {
      setSaving(false);
    }
  };

  const copyPassword = async () => {
    if (!newPassword) return;
    try {
      await navigator.clipboard.writeText(newPassword);
      toast.success("新密码已复制");
    } catch {
      toast.error("复制失败，请手动复制密码");
    }
  };

  const visibleItems = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return items.filter((user) => {
      if (requestedDeptId && user.deptId !== requestedDeptId) return false;
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
  }, [items, requestedDeptId, searchQuery]);

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
                              {` · ${model.currentlyAllowed ? "可用" : "当前不可用"}`}
                            </Badge>
                          ))
                        : <span className="text-xs text-muted-foreground">当前未开通模型</span>}
                    </div>
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

      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setUserFormInitial(null);
          }
        }}
      >
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-3xl">
          {selected ? (
            <>
              <SheetHeader className="border-b border-border pb-5 pr-8">
                <SheetTitle>详细编辑</SheetTitle>
                <SheetDescription>统一维护用户资料、角色、个人额度、可用模型、登录密码和账号状态。</SheetDescription>
              </SheetHeader>
              <div className="space-y-6 py-6">
                <div className="rounded-xl border border-border bg-muted/20 p-4">
                  <p className="font-medium">{selected.displayName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">本月已用 {formatTokenCount(selected.usedTokens)} Token · {quotaSourceLabel(selected)}</p>
                  <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                    <p className="break-all sm:col-span-2"><span className="text-muted-foreground">邮箱：</span>{selected.email}</p>
                    <p><span className="text-muted-foreground">部门：</span>{selected.departmentPath || selected.departmentName || "未归属组织"}</p>
                    {selected.jobTitle ? <p><span className="text-muted-foreground">岗位：</span>{selected.jobTitle}</p> : null}
                    <p><span className="text-muted-foreground">状态：</span>{selected.status === "active" ? "正常" : selected.status === "locked" ? "已锁定" : "已停用"}</p>
                  </div>
                </div>
                <section className="space-y-3">
                  <div>
                    <h2 className="text-sm font-medium">基本资料与角色</h2>
                    <p className="mt-1 text-xs text-muted-foreground">维护姓名、邮箱、组织、职位、账号状态和角色。</p>
                  </div>
                  {userFormLoading ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {[1, 2, 3, 4, 5, 6].map((key) => <Skeleton key={key} className="h-10" />)}
                    </div>
                  ) : userFormInitial ? (
                    <UserFormFields
                      values={userFormInitial}
                      onChange={setUserFormInitial}
                      deptOptions={userFormDeptOptions}
                      roleOptions={userFormRoleOptions}
                      idPrefix="user-detail"
                    />
                  ) : (
                    <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      用户资料加载失败，请关闭后重试。
                    </p>
                  )}
                </section>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="user-monthly-tokens">每月 Token 额度</Label>
                    <Button
                      type="button"
                      size="sm"
                      variant={unlimitedTokens ? "secondary" : "outline"}
                      aria-pressed={unlimitedTokens}
                      onClick={() => setQuotaUnlimited(!unlimitedTokens)}
                      disabled={saving}
                    >
                      {unlimitedTokens ? "不限额（已启用）" : "不限额"}
                    </Button>
                  </div>
                  <Input
                    id="user-monthly-tokens"
                    inputMode="numeric"
                    value={unlimitedTokens ? "0" : monthlyTokens}
                    onChange={(event) => {
                      const value = event.target.value.replace(/[^0-9]/g, "");
                      setMonthlyTokens(value);
                      setFiniteMonthlyTokens(value);
                    }}
                    placeholder="请输入正整数"
                    disabled={unlimitedTokens}
                    className={unlimitedTokens ? "bg-muted text-muted-foreground" : undefined}
                  />
                  <p className="text-xs text-muted-foreground">
                    {unlimitedTokens ? "已启用不限额，保存后以 0 兼容存储。" : "请输入正整数；如不限制额度，请点击右侧“不限额”。"}
                  </p>
                </div>
                <section className="space-y-3">
                  <div>
                    <h2 className="text-sm font-medium">可用模型</h2>
                    <p className="mt-1 text-xs text-muted-foreground">可用模型高亮；灰色模型受组织上限限制。用户可关闭来自用户组的模型，也可额外开通组织允许的模型。</p>
                  </div>
                  {loadingModels ? (
                    <div className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-2">
                      {[1, 2, 3, 4].map((key) => <Skeleton key={key} className="h-16" />)}
                    </div>
                  ) : (
                    <>
                      {modelAccess?.groupModelSources?.length ? (
                        <div className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                          {modelAccess.groupModelSources.map((group) => (
                            <span key={group.id}>{group.name} · {group.modelIds.length} 个模型</span>
                          ))}
                        </div>
                      ) : null}
                      <div className="grid max-h-80 gap-2 overflow-y-auto rounded-xl border border-border p-3 sm:grid-cols-2">
                        {modelOptions.length ? modelOptions.map((model) => {
                          const allowedByOrganization = parentAllowedModelIdSet.has(model.id);
                          const inheritedFromGroup = groupModelIdSet.has(model.id);
                          const excludedFromGroup = inheritedFromGroup && excludedGroupModelIdSet.has(model.id);
                          const individualExtra = manualModelIds.includes(model.id);
                          const available = allowedByOrganization && visibleModelIds.has(model.id);
                          return (
                            <label
                              key={model.id}
                              className={`flex items-start gap-2 rounded-lg border p-2 text-sm ${!allowedByOrganization || !modelAccess ? "cursor-not-allowed border-transparent bg-muted/50 opacity-45" : available ? "cursor-pointer border-primary/30 bg-primary/5" : "cursor-pointer border-transparent bg-muted/30 hover:bg-muted"}`}
                            >
                              <Checkbox
                                checked={available}
                                disabled={!allowedByOrganization || !modelAccess}
                                onCheckedChange={() => toggleModel(model.id)}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1.5"><span className="truncate font-medium">{model.label}</span>{!allowedByOrganization ? <Badge variant="outline">组织不可用</Badge> : excludedFromGroup ? <Badge variant="outline">个人关闭</Badge> : inheritedFromGroup ? <Badge variant="secondary">用户组</Badge> : individualExtra ? <Badge variant="outline">个人特例</Badge> : available ? <Badge variant="secondary">可用</Badge> : <Badge variant="outline">未开通</Badge>}</span>
                                <span className="block truncate text-xs text-muted-foreground">{model.providerLabel} · {model.id}</span>
                              </span>
                            </label>
                          );
                        }) : <p className="col-span-full p-2 text-sm text-muted-foreground">暂无可配置的已启用模型</p>}
                      </div>
                    </>
                  )}
                </section>
                <section className="space-y-3 border-t border-border pt-5">
                  <div>
                    <h2 className="text-sm font-medium">登录密码</h2>
                    <p className="mt-1 text-xs text-muted-foreground">重置后会生成新的随机登录密码，并解除该用户的登录锁定状态。</p>
                  </div>
                  {newPassword ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
                      <code className="min-w-0 flex-1 break-all text-sm font-medium">{newPassword}</code>
                      <Button size="sm" variant="outline" onClick={() => void copyPassword()}><Copy />复制</Button>
                    </div>
                  ) : resetPasswordPending ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                      <span className="flex-1">确认要为 {selected.displayName} 生成新的随机密码吗？</span>
                      <Button size="sm" variant="outline" onClick={() => setResetPasswordPending(false)} disabled={saving}>取消</Button>
                      <Button size="sm" onClick={() => void resetPassword()} disabled={saving}>{saving ? "重置中…" : "确认重置"}</Button>
                    </div>
                  ) : (
                    <Button variant="outline" onClick={() => setResetPasswordPending(true)} disabled={saving}><KeyRound />重置登录密码</Button>
                  )}
                </section>
              </div>
              <div className="mt-auto flex flex-wrap justify-between gap-2 border-t border-border pt-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="destructive"
                    onClick={() => void deleteUser()}
                    disabled={saving || selected.id === currentUserId}
                    title={selected.id === currentUserId ? "不能删除当前登录用户" : "删除用户"}
                  >
                    <Trash2 />删除用户
                  </Button>
                  <div className="flex flex-col gap-1">
                    <Button
                      variant="outline"
                      onClick={() => void restoreInheritedQuota()}
                      disabled={saving || selected.quotaSource !== "personal"}
                      title="恢复用户组或默认额度，不会清零已用 Token"
                    >
                      恢复继承额度
                    </Button>
                    {selected.quotaSource === "personal" ? (
                      <span className="max-w-56 text-[11px] text-muted-foreground">
                        恢复用户组（无用户组时为默认）额度，不会清零已用 Token。
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelected(null);
                      setUserFormInitial(null);
                    }}
                  >
                    取消
                  </Button>
                  <Button onClick={() => void save()} disabled={saving || loadingModels || userFormLoading || !userFormInitial}>
                    {saving ? "保存中…" : "保存详细信息"}
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultDeptId={requestedDeptId || undefined}
        onCreated={load}
      />
    </div>
  );
}
