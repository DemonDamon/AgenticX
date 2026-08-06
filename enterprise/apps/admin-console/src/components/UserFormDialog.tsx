"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Button,
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
} from "@agenticx/ui";
import { useTranslations } from "next-intl";
import { Check, Plus } from "lucide-react";

export type UserFormStatus = "active" | "disabled" | "locked";
export type UserFormDeptOption = { id: string; label: string };
export type UserFormRoleOption = { id: string; code: string; name: string };
export type UserFormValues = {
  email: string;
  displayName: string;
  status: UserFormStatus;
  deptId: string;
  phone: string;
  employeeNo: string;
  jobTitle: string;
  roleCodes: string[];
  initialPassword: string;
};

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

type UserFormDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  description?: ReactNode;
  submitLabel: string;
  initial?: UserFormValues;
  deptOptions: UserFormDeptOption[];
  roleOptions: UserFormRoleOption[];
  onSubmit: (values: UserFormValues) => Promise<void>;
};

export function UserFormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  initial,
  deptOptions,
  roleOptions,
  onSubmit,
}: UserFormDialogProps) {
  const t = useTranslations("pages.iam.users");
  const tc = useTranslations("common");
  const [values, setValues] = useState<UserFormValues>(() => initial ?? EMPTY_USER_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setValues(initial ?? EMPTY_USER_FORM);
  }, [open, initial]);

  const handleSubmit = async (event: FormEvent) => {
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
            <Label htmlFor="user-form-email">{t("form.emailLabel")}</Label>
            <Input
              id="user-form-email"
              type="email"
              required
              value={values.email}
              onChange={(event) => setValues((prev) => ({ ...prev, email: event.target.value }))}
              placeholder="user@your-company.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-form-name">{t("form.nameLabel")}</Label>
            <Input
              id="user-form-name"
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
                onValueChange={(value) => setValues((prev) => ({ ...prev, status: value as UserFormStatus }))}
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
                onValueChange={(value) => setValues((prev) => ({ ...prev, deptId: value === "__none__" ? "" : value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("form.deptPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("form.deptUnassigned")}</SelectItem>
                  {deptOptions.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="user-form-phone">{t("detail.phone")}</Label>
              <Input
                id="user-form-phone"
                value={values.phone}
                onChange={(event) => setValues((prev) => ({ ...prev, phone: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-form-employee-no">{t("detail.employeeNo")}</Label>
              <Input
                id="user-form-employee-no"
                value={values.employeeNo}
                onChange={(event) => setValues((prev) => ({ ...prev, employeeNo: event.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-form-job-title">{t("detail.jobTitle")}</Label>
            <Input
              id="user-form-job-title"
              value={values.jobTitle}
              onChange={(event) => setValues((prev) => ({ ...prev, jobTitle: event.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("detail.roles")}</Label>
            <div className="grid max-h-40 gap-1.5 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
              {roleOptions.map((role) => {
                const checked = values.roleCodes.includes(role.code);
                return (
                  <button
                    key={role.id}
                    type="button"
                    aria-pressed={checked}
                    className={[
                      "flex items-center gap-2 rounded px-2 py-1 text-left text-xs",
                      checked ? "bg-primary-soft ring-1 ring-primary" : "hover:bg-muted",
                    ].join(" ")}
                    onClick={() =>
                      setValues((prev) => {
                        const next = new Set(prev.roleCodes);
                        if (next.has(role.code)) next.delete(role.code);
                        else next.add(role.code);
                        const nextRoleCodes = [...next];
                        return { ...prev, roleCodes: nextRoleCodes.length ? nextRoleCodes : ["member"] };
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
                      <span className="font-mono text-[10px] text-muted-foreground">{role.code}</span> · {role.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

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
