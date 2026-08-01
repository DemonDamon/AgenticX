"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@agenticx/ui";
import { Copy, Plus } from "lucide-react";
import { adminFetch } from "../lib/admin-client-auth";

export type CreateUserDepartmentOption = { id: string; label: string };

type CreateUserFormValues = {
  displayName: string;
  email: string;
  deptId: string;
  phone: string;
  employeeNo: string;
  jobTitle: string;
  initialPassword: string;
  isAdmin: boolean;
};

type CreateUserResponse = {
  code: string;
  message: string;
  data?: { user?: unknown; initialPassword?: string };
};

function initialValues(defaultDeptId?: string | null): CreateUserFormValues {
  return {
    displayName: "",
    email: "",
    deptId: defaultDeptId ?? "",
    phone: "",
    employeeNo: "",
    jobTitle: "",
    initialPassword: "",
    isAdmin: false,
  };
}

export function CreateUserDialog({
  open,
  onOpenChange,
  defaultDeptId,
  departmentOptions,
  title = "新建用户",
  description = "创建后用户会立即进入用户列表；未填写初始密码时系统会自动生成随机密码。",
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDeptId?: string | null;
  departmentOptions?: CreateUserDepartmentOption[];
  title?: string;
  description?: string;
  onCreated?: (user: unknown) => void | Promise<void>;
}) {
  const [values, setValues] = useState<CreateUserFormValues>(() => initialValues(defaultDeptId));
  const [fetchedDepartments, setFetchedDepartments] = useState<CreateUserDepartmentOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [createdInitialPassword, setCreatedInitialPassword] = useState<string | null>(null);

  const options = useMemo(
    () => (departmentOptions?.length ? departmentOptions : fetchedDepartments),
    [departmentOptions, fetchedDepartments],
  );

  useEffect(() => {
    if (!open) return;
    setValues(initialValues(defaultDeptId));
    setCreatedInitialPassword(null);
  }, [defaultDeptId, open]);

  useEffect(() => {
    if (!open || (departmentOptions && departmentOptions.length > 0)) return;
    let alive = true;
    void (async () => {
      try {
        const response = await adminFetch("/api/admin/departments?shape=flat", { cache: "no-store" });
        const json = (await response.json()) as {
          data?: { items: Array<{ id: string; name: string; path: string }> };
        };
        if (!alive || !response.ok || !json.data?.items) return;
        setFetchedDepartments(
          json.data.items.map((department) => ({
            id: department.id,
            label: `${department.name}（${department.path}）`,
          })),
        );
      } catch {
        // 部门下拉失败时仍允许创建未归属用户。
      }
    })();
    return () => {
      alive = false;
    };
  }, [departmentOptions, open]);

  const update = <K extends keyof CreateUserFormValues>(field: K, value: CreateUserFormValues[K]) => {
    setCreatedInitialPassword(null);
    setValues((current) => ({ ...current, [field]: value }));
  };

  const copyCreatedPassword = async () => {
    if (!createdInitialPassword) return;
    try {
      await navigator.clipboard.writeText(createdInitialPassword);
      toast.success("初始密码已复制");
    } catch {
      toast.error("复制失败，请手动复制密码");
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const email = values.email.trim();
    const displayName = values.displayName.trim();
    const initialPassword = values.initialPassword.trim();
    if (!displayName) {
      toast.error("请输入姓名");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("请输入有效邮箱");
      return;
    }
    if (initialPassword && initialPassword.length < 8) {
      toast.error("初始密码至少 8 位");
      return;
    }

    setSubmitting(true);
    try {
      const response = await adminFetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          displayName,
          deptId: values.deptId || null,
          phone: values.phone.trim() || null,
          employeeNo: values.employeeNo.trim() || null,
          jobTitle: values.jobTitle.trim() || null,
          initialPassword: initialPassword || undefined,
          status: "active",
          isAdmin: values.isAdmin,
          roleCodes: values.isAdmin ? ["member", "admin"] : ["member"],
        }),
      });
      const json = (await response.json()) as CreateUserResponse;
      if (!response.ok || json.code !== "00000" || !json.data?.user) {
        throw new Error(json.message || "创建用户失败");
      }
      setCreatedInitialPassword(json.data.initialPassword ?? null);
      setValues(initialValues(defaultDeptId));
      toast.success("已创建用户");
      await onCreated?.(json.data.user);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建用户失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          {createdInitialPassword ? (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
              <p className="text-sm font-medium">初始密码（仅显示一次）</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-md bg-background px-2 py-1 text-sm">
                  {createdInitialPassword}
                </code>
                <Button type="button" size="sm" variant="outline" onClick={() => void copyCreatedPassword()}>
                  <Copy className="h-4 w-4" />复制
                </Button>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="create-user-display-name">姓名</Label>
              <Input
                id="create-user-display-name"
                required
                value={values.displayName}
                onChange={(event) => update("displayName", event.target.value)}
                placeholder="例如：张三"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-user-email">邮箱</Label>
              <Input
                id="create-user-email"
                type="email"
                required
                value={values.email}
                onChange={(event) => update("email", event.target.value)}
                placeholder="name@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-user-department">所属部门</Label>
              <Select
                value={values.deptId || "__none__"}
                onValueChange={(value) => update("deptId", value === "__none__" ? "" : value)}
              >
                <SelectTrigger id="create-user-department">
                  <SelectValue placeholder="请选择部门" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未归属部门</SelectItem>
                  {options.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-user-phone">手机</Label>
              <Input
                id="create-user-phone"
                value={values.phone}
                onChange={(event) => update("phone", event.target.value)}
                placeholder="可选"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-user-employee-no">工号</Label>
              <Input
                id="create-user-employee-no"
                value={values.employeeNo}
                onChange={(event) => update("employeeNo", event.target.value)}
                placeholder="可选"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-user-job-title">职位</Label>
              <Input
                id="create-user-job-title"
                value={values.jobTitle}
                onChange={(event) => update("jobTitle", event.target.value)}
                placeholder="可选"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="create-user-password">初始密码</Label>
              <Input
                id="create-user-password"
                type="password"
                autoComplete="new-password"
                value={values.initialPassword}
                onChange={(event) => update("initialPassword", event.target.value)}
                placeholder="留空自动生成"
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <Checkbox checked={values.isAdmin} onCheckedChange={(checked) => update("isAdmin", checked === true)} />
            <span>管理员</span>
          </label>

          <DialogFooter className="mt-4">
            {createdInitialPassword ? (
              <Button type="button" variant="outline" onClick={() => setCreatedInitialPassword(null)}>
                继续新建
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              <Plus />
              {submitting ? "创建中…" : "创建用户"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
