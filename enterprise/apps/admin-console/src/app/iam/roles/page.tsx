"use client";
import { adminFetch } from "../../../lib/admin-client-auth";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageHeader,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  toast,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";
import { ALL_REGISTERED_SCOPES, SCOPE_REGISTRY } from "@agenticx/iam-core/scope-registry";
import { Check, Copy, KeyRound, Pencil, Plus, RefreshCw, Shield, ShieldAlert, Trash2, UserCog, Users } from "lucide-react";

type RoleRow = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  scopes: string[];
  immutable: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

type ApiEnvelope<T> = { code: string; message: string; data?: T };

const ROLE_ICONS: Record<string, { icon: React.ReactNode; accent: string; label: string }> = {
  super_admin: { icon: <ShieldAlert className="h-5 w-5" />, accent: "bg-chart-4", label: "Super" },
  owner: { icon: <ShieldAlert className="h-5 w-5" />, accent: "bg-chart-4", label: "Owner" },
  admin: { icon: <Shield className="h-5 w-5" />, accent: "bg-primary", label: "Admin" },
  auditor: { icon: <KeyRound className="h-5 w-5" />, accent: "bg-chart-6", label: "Auditor" },
  member: { icon: <UserCog className="h-5 w-5" />, accent: "bg-chart-2", label: "Member" },
};

function buildMatrix(allRoles: RoleRow[]) {
  const resourceMap = new Map<string, Set<string>>();
  for (const role of allRoles) {
    for (const scope of role.scopes) {
      if (scope === "*") {
        for (const s of ALL_REGISTERED_SCOPES) {
          const [resource, action] = s.split(":");
          if (!resource || !action) continue;
          if (!resourceMap.has(resource)) resourceMap.set(resource, new Set());
          resourceMap.get(resource)!.add(action);
        }
        continue;
      }
      const [resource, action] = scope.split(":");
      if (!resource || !action) continue;
      if (!resourceMap.has(resource)) resourceMap.set(resource, new Set());
      resourceMap.get(resource)!.add(action);
    }
  }
  return Array.from(resourceMap.entries())
    .map(([resource, actions]) => ({
      resource,
      actions: Array.from(actions).sort(),
    }))
    .sort((a, b) => a.resource.localeCompare(b.resource));
}

function roleHasScope(role: RoleRow, scope: string): boolean {
  if (role.scopes.includes("*")) return true;
  return role.scopes.includes(scope);
}

function ScopeMatrixEditor({
  value,
  onChange,
}: {
  value: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const t = useTranslations("pages.iam.roles");
  const resourceLabels = useMemo(
    (): Record<string, string> => ({
      user: t("resources.user"),
      dept: t("resources.dept"),
      role: t("resources.role"),
      audit: t("resources.audit"),
      metering: t("resources.metering"),
      workspace: t("resources.workspace"),
      tenant: t("resources.tenant"),
      admin: t("resources.admin"),
      policy: t("resources.policy"),
      model: t("resources.model"),
      kb: t("resources.kb"),
      automation: t("resources.automation"),
      gateway: t("resources.gateway"),
      provider: t("resources.provider"),
    }),
    [t]
  );
  const toggle = (s: string) => {
    const n = new Set(value);
    if (n.has(s)) n.delete(s);
    else n.add(s);
    onChange(n);
  };

  return (
    <div className="h-[280px] overflow-y-auto rounded-md border border-border p-3">
      <div className="space-y-4">
        {Object.entries(SCOPE_REGISTRY).map(([resource, verbs]) => (
          <div key={resource}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {resourceLabels[resource] ?? resource}
            </div>
            <div className="flex flex-wrap gap-2">
              {verbs.map((verb) => {
                const s = `${resource}:${verb}`;
                return (
                  <label key={s} className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
                    <Checkbox checked={value.has(s)} onCheckedChange={() => toggle(s)} />
                    <span className="font-mono">{s}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RolesPage() {
  const t = useTranslations("pages.iam.roles");
  const tc = useTranslations("common");
  const ts = useTranslations("shell");
  const resourceLabels = useMemo(
    (): Record<string, string> => ({
      user: t("resources.user"),
      dept: t("resources.dept"),
      role: t("resources.role"),
      audit: t("resources.audit"),
      metering: t("resources.metering"),
      workspace: t("resources.workspace"),
      tenant: t("resources.tenant"),
      admin: t("resources.admin"),
      policy: t("resources.policy"),
      model: t("resources.model"),
      kb: t("resources.kb"),
      automation: t("resources.automation"),
      gateway: t("resources.gateway"),
      provider: t("resources.provider"),
    }),
    [t]
  );
  const actionLabels = useMemo(
    (): Record<string, string> => ({
      create: t("actions.create"),
      read: t("actions.read"),
      update: t("actions.update"),
      delete: t("actions.delete"),
      manage: t("actions.manage"),
      chat: t("actions.chat"),
      enter: t("actions.enter"),
      export: t("actions.export"),
    }),
    [t]
  );
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRoleCode, setActiveRoleCode] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newScopes, setNewScopes] = useState<Set<string>>(() => new Set(["workspace:chat"]));

  const [dupOpen, setDupOpen] = useState(false);
  const [dupSource, setDupSource] = useState<RoleRow | null>(null);
  const [dupCode, setDupCode] = useState("");
  const [dupName, setDupName] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RoleRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editScopes, setEditScopes] = useState<Set<string>>(new Set());

  const [membersOpen, setMembersOpen] = useState(false);
  const [membersRole, setMembersRole] = useState<RoleRow | null>(null);
  const [members, setMembers] = useState<Array<{ id: string; email: string; displayName: string }>>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/roles", { cache: "no-store" });
      const json = (await res.json()) as ApiEnvelope<{ items: RoleRow[] }>;
      if (!res.ok || !json.data?.items) {
        toast.error(json.message ?? t("toast.loadFailed"));
        return;
      }
      setRoles(json.data.items);
      setActiveRoleCode((prev) => {
        if (prev && json.data!.items.some((r) => r.code === prev)) return prev;
        return json.data!.items[0]?.code ?? null;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.networkError"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const matrix = useMemo(() => buildMatrix(roles), [roles]);
  const activeRole = roles.find((r) => r.code === activeRoleCode) ?? null;

  const openMembers = async (role: RoleRow) => {
    setMembersRole(role);
    setMembersOpen(true);
    setMembersLoading(true);
    try {
      const res = await fetch(`/api/admin/roles/${role.id}/users`, { cache: "no-store" });
      const json = (await res.json()) as ApiEnvelope<{
        users: Array<{ id: string; email: string; displayName: string }>;
      }>;
      if (!res.ok || !json.data?.users) {
        toast.error(json.message ?? t("toast.membersLoadFailed"));
        setMembers([]);
        return;
      }
      setMembers(json.data.users);
    } finally {
      setMembersLoading(false);
    }
  };

  const handleCreate = async () => {
    const code = newCode.trim().toLowerCase().replace(/\s+/g, "_");
    if (!code || !newName.trim()) {
      toast.error(t("toast.fillCodeAndName"));
      return;
    }
    const scopes = [...newScopes];
    if (!scopes.length) {
      toast.error(t("toast.pickScope"));
      return;
    }
    const res = await adminFetch("/api/admin/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: newName.trim(), scopes }),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? t("toast.createFailed"));
      return;
    }
    toast.success(t("toast.created"));
    setCreateOpen(false);
    setNewCode("");
    setNewName("");
    setNewScopes(new Set(["workspace:chat"]));
    await load();
  };

  const handleDuplicate = async () => {
    if (!dupSource || !dupCode.trim() || !dupName.trim()) return;
    const res = await adminFetch("/api/admin/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "duplicate",
        sourceId: dupSource.id,
        newCode: dupCode.trim().toLowerCase().replace(/\s+/g, "_"),
        newName: dupName.trim(),
      }),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? t("toast.duplicateFailed"));
      return;
    }
    toast.success(t("toast.duplicated"));
    setDupOpen(false);
    setDupSource(null);
    await load();
  };

  const handleSaveEdit = async () => {
    if (!editTarget || !editName.trim()) return;
    const scopes = [...editScopes];
    const res = await fetch(`/api/admin/roles/${editTarget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim(), scopes }),
    });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? t("toast.saveFailed"));
      return;
    }
    toast.success(t("toast.saved"));
    setEditOpen(false);
    await load();
  };

  const handleDelete = async (role: RoleRow) => {
    if (role.immutable) return;
    const res = await fetch(`/api/admin/roles/${role.id}`, { method: "DELETE" });
    const json = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(json.message ?? t("toast.deleteFailed"));
      return;
    }
    toast.success(t("toast.deleted"));
    if (activeRoleCode === role.code) setActiveRoleCode(roles.find((r) => r.id !== role.id)?.code ?? null);
    await load();
  };

  const removeMemberRole = async (userId: string) => {
    if (!membersRole) return;
    const ures = await fetch(`/api/admin/users/${userId}`, { cache: "no-store" });
    const ujson = (await ures.json()) as ApiEnvelope<{ user: { roleCodes: string[] } }>;
    if (!ures.ok || !ujson.data?.user) {
      toast.error(t("toast.readUserFailed"));
      return;
    }
    const nextCodes = ujson.data.user.roleCodes.filter((c) => c !== membersRole.code);
    const pres = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleCodes: nextCodes }),
    });
    const pjson = (await pres.json()) as { message?: string };
    if (!pres.ok) {
      toast.error(pjson.message ?? t("toast.removeFailed"));
      return;
    }
    toast.success(t("toast.memberRemoved"));
    await openMembers(membersRole);
    await load();
  };

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
                <BreadcrumbPage>{t("breadcrumbRoles")}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t("newRole")}
            </Button>
          </div>
        }
      />

      {loading && !roles.length ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {roles.map((role) => {
            const meta = ROLE_ICONS[role.code] ?? {
              icon: <UserCog className="h-5 w-5" />,
              accent: "bg-muted",
              label: role.code,
            };
            const active = role.code === activeRoleCode;
            return (
              <div
                key={role.id}
                className={[
                  "group relative overflow-hidden rounded-xl border bg-card shadow-sm transition-all",
                  active ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-border-strong hover:shadow-md",
                ].join(" ")}
              >
                <div className="cursor-pointer p-4 pb-0" onClick={() => setActiveRoleCode(role.code)}>
                  <div className={["pointer-events-none absolute inset-x-0 -top-px h-0.5", meta.accent].join(" ")} />
                  <div className="flex items-start justify-between">
                    <span
                      className={[
                        "flex h-10 w-10 items-center justify-center rounded-lg text-primary-foreground",
                        meta.accent,
                      ].join(" ")}
                    >
                      {meta.icon}
                    </span>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={active ? "default" : "soft"}>{role.code}</Badge>
                      {role.immutable ? (
                        <Badge variant="outline" className="text-[10px]">
                          {t("systemBadge")}
                        </Badge>
                      ) : null}
                      <Badge variant="soft" className="font-mono text-[10px]">
                        {t("memberCount", { count: role.memberCount })}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 space-y-1 pr-2">
                    <h3 className="text-base font-semibold">{role.name}</h3>
                    <p className="text-xs text-muted-foreground">
{role.scopes.includes("*") ? t("allScopes") : t("scopeCount", { count: role.scopes.length })}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 border-t border-border p-4 pt-3">
                  <Button variant="outline" size="xs" onClick={() => void openMembers(role)}>
                    <Users className="mr-1 h-3 w-3" />
                    {t("members")}
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      setDupSource(role);
                      setDupCode(`${role.code}_copy`);
                      setDupName(`${role.name}${t("duplicateNameSuffix")}`);
                      setDupOpen(true);
                    }}
                  >
                    <Copy className="mr-1 h-3 w-3" />
                    {t("duplicate")}
                  </Button>
                  {!role.immutable ? (
                    <>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          setEditTarget(role);
                          setEditName(role.name);
                          setEditScopes(new Set(role.scopes.includes("*") ? ALL_REGISTERED_SCOPES : role.scopes));
                          setEditOpen(true);
                        }}
                      >
                        <Pencil className="mr-1 h-3 w-3" />
                        {t("edit")}
                      </Button>
                      <Button variant="ghost" size="xs" className="text-danger" onClick={() => void handleDelete(role)}>
                        <Trash2 className="mr-1 h-3 w-3" />
                        {t("delete")}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {activeRole ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{activeRole.name}</CardTitle>
                <CardDescription>
                  {activeRole.code} · {activeRole.immutable ? t("builtin") : t("custom")}
                </CardDescription>
              </div>
              <div className="flex max-w-xl flex-wrap gap-1">
                {(activeRole.scopes.includes("*") ? ALL_REGISTERED_SCOPES : activeRole.scopes).slice(0, 8).map((scope) => (
                  <Badge key={scope} variant="soft" className="font-mono text-[10px]">
                    {scope}
                  </Badge>
                ))}
              </div>
            </div>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("matrixTitle")}</CardTitle>
          <CardDescription>{t("matrixDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="border-b border-border">
                  <th className="sticky left-0 z-10 min-w-[160px] bg-muted/40 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("resourceActionHeader")}
                  </th>
                  {roles.map((role) => (
                    <th
                      key={role.id}
                      className="min-w-[100px] px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {ROLE_ICONS[role.code]?.label ?? role.code}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map(({ resource, actions }) => (
                  <Fragment key={resource}>
                    <tr className="border-b border-border bg-surface-subtle">
                      <td
                        className="sticky left-0 z-10 bg-surface-subtle px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                        colSpan={roles.length + 1}
                      >
                        {resourceLabels[resource] ?? resource}
                      </td>
                    </tr>
                    {actions.map((action) => {
                      const scope = `${resource}:${action}`;
                      return (
                        <tr key={scope} className="border-b border-border last:border-0 hover:bg-muted/30">
                          <td className="sticky left-0 z-10 bg-card px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="h-1.5 w-1.5 rounded-full bg-primary/60" aria-hidden />
                              <span className="font-mono text-xs text-foreground">{scope}</span>
                              <span className="text-xs text-muted-foreground">{actionLabels[action] ?? action}</span>
                            </div>
                          </td>
                          {roles.map((role) => {
                            const allowed = roleHasScope(role, scope);
                            return (
                              <td key={`${role.id}-${scope}`} className="px-3 py-2.5 text-center">
                                {allowed ? (
                                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-success-soft text-success">
                                    <Check className="h-3.5 w-3.5" />
                                  </span>
                                ) : (
                                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                    —
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <Separator />
          <div className="flex flex-wrap items-center gap-4 px-4 py-3 text-xs text-muted-foreground">
<span>{t("comboCount", { count: matrix.reduce((sum, row) => sum + row.actions.length, 0) })}</span>
          </div>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("createDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>{t("codeLabel")}</Label>
                <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder={t("codePlaceholder")} />
              </div>
              <div>
                <Label>{t("nameLabel")}</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("namePlaceholder")} />
              </div>
            </div>
            <div>
              <Label className="mb-2 block">{t("scopesLabel")}</Label>
              <ScopeMatrixEditor value={newScopes} onChange={setNewScopes} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={() => void handleCreate()}>{t("actions.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dupOpen} onOpenChange={setDupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("duplicateDialogTitle")}</DialogTitle>
          </DialogHeader>
<p className="text-xs text-muted-foreground">{t("duplicateSource")}{dupSource?.name ?? "—"}</p>
          <div className="grid gap-2">
            <div>
              <Label>{t("newCodeLabel")}</Label>
              <Input value={dupCode} onChange={(e) => setDupCode(e.target.value)} />
            </div>
            <div>
              <Label>{t("newNameLabel")}</Label>
              <Input value={dupName} onChange={(e) => setDupName(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDupOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={() => void handleDuplicate()}>{t("duplicate")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("editDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
<Label>{t("nameLabel")}</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div>
<Label className="mb-2 block">{t("scopesLabel")}</Label>
              <ScopeMatrixEditor value={editScopes} onChange={setEditScopes} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              {tc("actions.cancel")}
            </Button>
<Button onClick={() => void handleSaveEdit()}>{tc("actions.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={membersOpen} onOpenChange={setMembersOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
<SheetTitle>{t("membersSheetTitle")} {membersRole?.name}</SheetTitle>
            <SheetDescription>{t("membersSheetDescription")}</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {membersLoading ? (
              <p className="text-sm text-muted-foreground">{t("loading")}</p>
            ) : members.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("membersEmpty")}</p>
            ) : (
              members.map((u) => (
                <div key={u.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{u.displayName}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{u.email}</div>
                  </div>
                  <Button variant="ghost" size="xs" onClick={() => void removeMemberRole(u.id)}>
                    {t("removeMember")}
                  </Button>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
