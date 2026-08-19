"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
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
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { adminFetch } from "../lib/admin-client-auth";
import { formatTokenCount } from "./QuotaRing";
import { BudgetScopeEditor } from "./metering/BudgetScopeEditor";
import {
  UserFormFields,
  type UserFormDeptOption,
  type UserFormRoleOption,
  type UserFormValues,
} from "./UserFormDialog";

type UserModelSummary = { model: string; tokens: number; currentlyAllowed: boolean };

export type UserDetailOverview = {
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

export type UserDetailTarget = Pick<UserDetailOverview, "id" | "displayName" | "email"> &
  Partial<Omit<UserDetailOverview, "id" | "displayName" | "email">>;

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

type UserDetailEditorProps = {
  target: UserDetailTarget | null;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void | Promise<void>;
};

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

function quotaSourceLabel(user: UserDetailOverview): string {
  if (user.quotaSource === "group") {
    return user.quotaSourceLabel ? `继承自 ${user.quotaSourceLabel}` : "继承自用户组";
  }
  if (user.quotaSource === "personal") return "个人设置";
  return "默认设置";
}

export function UserDetailEditor({ target, onOpenChange, onChanged }: UserDetailEditorProps) {
  const [overview, setOverview] = useState<UserDetailOverview | null>(null);
  const [monthlyTokens, setMonthlyTokens] = useState("");
  const [unlimitedTokens, setUnlimitedTokens] = useState(false);
  const [finiteMonthlyTokens, setFiniteMonthlyTokens] = useState("");
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelAccess, setModelAccess] = useState<ModelAccess | null>(null);
  const [manualModelIds, setManualModelIds] = useState<string[]>([]);
  const [initialManualModelIds, setInitialManualModelIds] = useState<string[]>([]);
  const [excludedGroupModelIds, setExcludedGroupModelIds] = useState<string[]>([]);
  const [initialExcludedGroupModelIds, setInitialExcludedGroupModelIds] = useState<string[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetPasswordPending, setResetPasswordPending] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [userFormInitial, setUserFormInitial] = useState<UserFormValues | null>(null);
  const [userFormDeptOptions, setUserFormDeptOptions] = useState<UserFormDeptOption[]>([]);
  const [userFormRoleOptions, setUserFormRoleOptions] = useState<UserFormRoleOption[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await adminFetch("/api/auth/session", { cache: "no-store" });
        const json = (await response.json()) as { data?: { userId?: string } };
        if (active) setCurrentUserId(json.data?.userId ?? null);
      } catch {
        // 删除接口仍会在服务端阻止删除当前登录用户。
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!target) {
      setOverview(null);
      setUserFormInitial(null);
      return;
    }

    let active = true;
    const userId = target.id;
    setOverview(null);
    setUserFormInitial(null);
    setUserFormDeptOptions([]);
    setUserFormRoleOptions([]);
    setModelOptions([]);
    setModelAccess(null);
    setManualModelIds([]);
    setInitialManualModelIds([]);
    setExcludedGroupModelIds([]);
    setInitialExcludedGroupModelIds([]);
    setResetPasswordPending(false);
    setNewPassword(null);
    setLoadingDetails(true);
    setLoadingModels(true);

    void (async () => {
      try {
        const [overviewResponse, modelResponse, userResponse, departmentResponse, roleResponse, providerResponse] =
          await Promise.all([
            adminFetch("/api/admin/users/quota-overview", { cache: "no-store" }),
            adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/models`, { cache: "no-store" }),
            adminFetch(`/api/admin/users/${encodeURIComponent(userId)}`, { cache: "no-store" }),
            adminFetch("/api/admin/departments?shape=flat", { cache: "no-store" }),
            adminFetch("/api/admin/roles", { cache: "no-store" }),
            adminFetch("/api/admin/providers", { cache: "no-store" }),
          ]);
        const [overviewJson, modelJson, userJson, departmentJson, roleJson, providerJson] = await Promise.all([
          overviewResponse.json() as Promise<ApiEnvelope<{ items: UserDetailOverview[] }>>,
          modelResponse.json() as Promise<ApiEnvelope<ModelAccess>>,
          userResponse.json() as Promise<ApiEnvelope<{ user: EditableUser }>>,
          departmentResponse.json() as Promise<ApiEnvelope<{ items: Array<{ id: string; name: string; path: string }> }>>,
          roleResponse.json() as Promise<ApiEnvelope<{ items: UserFormRoleOption[] }>>,
          providerResponse.json() as Promise<{
            data?: {
              providers: Array<{
                id: string;
                displayName: string;
                enabled: boolean;
                models: Array<{ name: string; label: string; enabled: boolean }>;
              }>;
            };
          }>,
        ]);
        if (!active) return;

        const selectedOverview = overviewJson.data?.items.find((item) => item.id === userId);
        if (!overviewResponse.ok || overviewJson.code !== "00000" || !selectedOverview) {
          throw new Error(overviewJson.message || "加载用户额度信息失败");
        }
        if (!userResponse.ok || userJson.code !== "00000" || !userJson.data?.user) {
          throw new Error(userJson.message || "加载用户信息失败");
        }
        if (!departmentResponse.ok || departmentJson.code !== "00000") {
          throw new Error(departmentJson.message || "加载部门失败");
        }
        if (!roleResponse.ok || roleJson.code !== "00000") {
          throw new Error(roleJson.message || "加载角色失败");
        }

        setOverview(selectedOverview);
        const userHasNoLimit = selectedOverview.unlimited || selectedOverview.monthlyTokens <= 0;
        const initialMonthlyTokens = userHasNoLimit ? "0" : String(selectedOverview.monthlyTokens);
        setUnlimitedTokens(userHasNoLimit);
        setMonthlyTokens(initialMonthlyTokens);
        setFiniteMonthlyTokens(userHasNoLimit ? "" : initialMonthlyTokens);

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

        const options = (providerJson.data?.providers ?? []).flatMap((provider) =>
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
        setModelOptions(
          options.sort(
            (left, right) =>
              left.providerLabel.localeCompare(right.providerLabel) || left.label.localeCompare(right.label),
          ),
        );

        if (!modelResponse.ok || modelJson.code !== "00000" || !modelJson.data) {
          toast.error(modelJson.message || "加载可用模型失败");
          return;
        }
        const groupModelIds = new Set(modelJson.data.groupModelIds ?? []);
        const individualModelIds = (modelJson.data.individualModelIds ?? []).filter(
          (modelId) => !groupModelIds.has(modelId),
        );
        setModelAccess(modelJson.data);
        setManualModelIds(individualModelIds);
        setInitialManualModelIds(individualModelIds);
        const excludedIds = modelJson.data.excludedGroupModelIds ?? [];
        setExcludedGroupModelIds(excludedIds);
        setInitialExcludedGroupModelIds(excludedIds);
      } catch (error) {
        if (active) toast.error(error instanceof Error ? error.message : "加载用户详细信息失败");
      } finally {
        if (active) {
          setLoadingDetails(false);
          setLoadingModels(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [target]);

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

  const closeAndRefresh = async () => {
    onOpenChange(false);
    await onChanged?.();
  };

  const save = async () => {
    if (!overview || !userFormInitial || saving || loadingDetails) return;
    if (!userFormInitial.email.trim() || !userFormInitial.displayName.trim()) {
      toast.error("请填写邮箱和姓名");
      return;
    }
    const nextQuota = unlimitedTokens ? 0 : Number(monthlyTokens);
    if (!unlimitedTokens && (!Number.isInteger(nextQuota) || nextQuota <= 0)) {
      toast.error("请关闭不限额后输入正整数 Token 额度");
      return;
    }
    const quotaChanged = Math.floor(nextQuota) !== overview.monthlyTokens;
    const modelsChanged =
      !sameIds(manualModelIds, initialManualModelIds) ||
      !sameIds(excludedGroupModelIds, initialExcludedGroupModelIds);
    setSaving(true);
    try {
      const requests: Promise<Response>[] = [
        adminFetch(`/api/admin/users/${encodeURIComponent(overview.id)}`, {
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
          adminFetch(`/api/admin/users/${encodeURIComponent(overview.id)}/quota`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ monthlyTokens: Math.floor(nextQuota) }),
          }),
        );
      }
      if (modelsChanged) {
        requests.push(
          adminFetch(`/api/admin/users/${encodeURIComponent(overview.id)}/models`, {
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
      await closeAndRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const restoreInheritedQuota = async () => {
    if (!overview || saving || overview.quotaSource !== "personal") return;
    setSaving(true);
    try {
      const response = await adminFetch(`/api/admin/users/${encodeURIComponent(overview.id)}/quota`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inherit: true }),
      });
      const json = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || json.code !== "00000") throw new Error(json.message || "恢复继承额度失败");
      toast.success("已恢复继承额度");
      await closeAndRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "恢复继承额度失败");
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async () => {
    if (!overview || saving) return;
    setSaving(true);
    try {
      const response = await adminFetch(`/api/admin/users/${encodeURIComponent(overview.id)}/reset-password`, {
        method: "POST",
      });
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
    if (!overview || saving) return;
    if (overview.id === currentUserId) {
      toast.error("不能删除当前登录用户");
      return;
    }
    if (!window.confirm(`确认删除用户 ${overview.email}？该操作不可撤销。`)) return;
    setSaving(true);
    try {
      const response = await adminFetch(`/api/admin/users/${encodeURIComponent(overview.id)}`, { method: "DELETE" });
      const json = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || json.code !== "00000") throw new Error(json.message || "删除用户失败");
      toast.success(`用户已删除：${overview.email}`);
      await closeAndRefresh();
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

  const displayName = overview?.displayName ?? target?.displayName ?? "用户";
  const email = overview?.email ?? target?.email ?? "";

  return (
    <Sheet open={Boolean(target)} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-3xl">
        {target ? (
          <>
            <SheetHeader className="shrink-0 border-b border-border pb-5 pr-8">
              <SheetTitle>详细编辑</SheetTitle>
              <SheetDescription>统一维护用户资料、角色、个人额度、可用模型、登录密码和账号状态。</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto py-6 pr-1">
              <div className="rounded-xl border border-border bg-muted/20 p-4">
                <p className="font-medium">{displayName}</p>
                {overview ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    本月已用 {formatTokenCount(overview.usedTokens)} Token · {quotaSourceLabel(overview)}
                  </p>
                ) : (
                  <Skeleton className="mt-2 h-4 w-52" />
                )}
                <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <p className="break-all sm:col-span-2"><span className="text-muted-foreground">邮箱：</span>{email}</p>
                  {overview ? (
                    <>
                      <p><span className="text-muted-foreground">部门：</span>{overview.departmentPath || overview.departmentName || "未归属组织"}</p>
                      {overview.jobTitle ? <p><span className="text-muted-foreground">岗位：</span>{overview.jobTitle}</p> : null}
                      <p><span className="text-muted-foreground">状态：</span>{overview.status === "active" ? "正常" : overview.status === "locked" ? "已锁定" : "已停用"}</p>
                    </>
                  ) : null}
                </div>
              </div>

              <section className="space-y-3">
                <div>
                  <h2 className="text-sm font-medium">基本资料与角色</h2>
                  <p className="mt-1 text-xs text-muted-foreground">维护姓名、邮箱、组织、职位、账号状态和角色。</p>
                </div>
                {loadingDetails ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[1, 2, 3, 4, 5, 6].map((key) => <Skeleton key={key} className="h-10" />)}
                  </div>
                ) : userFormInitial ? (
                  <UserFormFields
                    values={userFormInitial}
                    onChange={setUserFormInitial}
                    deptOptions={userFormDeptOptions}
                    roleOptions={userFormRoleOptions}
                    idPrefix={`user-detail-${target.id}`}
                  />
                ) : (
                  <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    用户资料加载失败，请关闭后重试。
                  </p>
                )}
              </section>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor={`user-monthly-tokens-${target.id}`}>每月 Token 额度</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant={unlimitedTokens ? "secondary" : "outline"}
                    aria-pressed={unlimitedTokens}
                    onClick={() => setQuotaUnlimited(!unlimitedTokens)}
                    disabled={saving || loadingDetails}
                  >
                    {unlimitedTokens ? "不限额（已启用）" : "不限额"}
                  </Button>
                </div>
                <Input
                  id={`user-monthly-tokens-${target.id}`}
                  inputMode="numeric"
                  value={unlimitedTokens ? "0" : monthlyTokens}
                  onChange={(event) => {
                    const value = event.target.value.replace(/[^0-9]/g, "");
                    setMonthlyTokens(value);
                    setFiniteMonthlyTokens(value);
                  }}
                  placeholder="请输入正整数"
                  disabled={unlimitedTokens || loadingDetails}
                  className={unlimitedTokens ? "bg-muted text-muted-foreground" : undefined}
                />
                <p className="text-xs text-muted-foreground">
                  {unlimitedTokens ? "当前不限制每月 Token 使用量。" : "请输入正整数；如不限制额度，请点击右侧“不限额”。"}
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
                              <span className="flex items-center gap-1.5">
                                <span className="truncate font-medium">{model.label}</span>
                                {!allowedByOrganization ? <Badge variant="outline">组织不可用</Badge> : excludedFromGroup ? <Badge variant="outline">个人关闭</Badge> : inheritedFromGroup ? <Badge variant="secondary">用户组</Badge> : individualExtra ? <Badge variant="outline">个人特例</Badge> : available ? <Badge variant="secondary">可用</Badge> : <Badge variant="outline">未开通</Badge>}
                              </span>
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
                  <h2 className="text-sm font-medium">个人预算</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    这个人每周期最多花多少钱。和上面的 Token 额度各算各的，先撞上哪个就被
                    哪个拦。原来要把用户 ID 贴进预算页的一个输入框才能配。
                  </p>
                </div>
                <BudgetScopeEditor scope="users" id={target.id} onSaved={onChanged} />
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
                    <span className="flex-1">确认要为 {displayName} 生成新的随机密码吗？</span>
                    <Button size="sm" variant="outline" onClick={() => setResetPasswordPending(false)} disabled={saving}>取消</Button>
                    <Button size="sm" onClick={() => void resetPassword()} disabled={saving}>{saving ? "重置中…" : "确认重置"}</Button>
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => setResetPasswordPending(true)} disabled={saving || !overview}><KeyRound />重置登录密码</Button>
                )}
              </section>
            </div>

            <div className="shrink-0 flex flex-wrap justify-between gap-2 border-t border-border bg-background pt-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  onClick={() => void deleteUser()}
                  disabled={saving || !overview || overview.id === currentUserId}
                  title={overview?.id === currentUserId ? "不能删除当前登录用户" : "删除用户"}
                >
                  <Trash2 />删除用户
                </Button>
                <div className="flex flex-col gap-1">
                  <Button
                    variant="outline"
                    onClick={() => void restoreInheritedQuota()}
                    disabled={saving || overview?.quotaSource !== "personal"}
                    title="恢复用户组或默认额度，不会清零已用 Token"
                  >
                    恢复继承额度
                  </Button>
                  {overview?.quotaSource === "personal" ? (
                    <span className="max-w-56 text-[11px] text-muted-foreground">
                      恢复用户组（无用户组时为默认）额度，不会清零已用 Token。
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
                <Button onClick={() => void save()} disabled={saving || loadingModels || loadingDetails || !overview || !userFormInitial}>
                  {saving ? "保存中…" : "保存详细信息"}
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
