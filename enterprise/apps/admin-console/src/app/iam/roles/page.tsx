"use client";

import { useMemo, useState } from "react";
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
  PageHeader,
  Separator,
} from "@agenticx/ui";
import { SYSTEM_ROLE_TEMPLATES } from "@agenticx/feature-iam";
import { Check, KeyRound, Plus, Shield, ShieldAlert, UserCog } from "lucide-react";

const ROLE_ICONS: Record<string, { icon: React.ReactNode; accent: string; label: string }> = {
  owner: { icon: <ShieldAlert className="h-5 w-5" />, accent: "bg-chart-4", label: "Owner" },
  admin: { icon: <Shield className="h-5 w-5" />, accent: "bg-primary", label: "Admin" },
  auditor: { icon: <KeyRound className="h-5 w-5" />, accent: "bg-chart-6", label: "Auditor" },
  member: { icon: <UserCog className="h-5 w-5" />, accent: "bg-chart-2", label: "Member" },
};

/**
 * 把 scope（形如 user:create）按资源分组，生成矩阵行。
 */
function buildMatrix(allRoles: Array<[string, { scopes: string[] }]>) {
  const resourceMap = new Map<string, Set<string>>();
  for (const [, role] of allRoles) {
    for (const scope of role.scopes) {
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

const RESOURCE_LABELS: Record<string, string> = {
  user: "用户",
  dept: "部门",
  role: "角色",
  audit: "审计",
  metering: "计量",
  workspace: "工作区",
  tenant: "租户",
};

const ACTION_LABELS: Record<string, string> = {
  create: "创建",
  read: "读取",
  update: "修改",
  delete: "删除",
  manage: "管理",
  chat: "对话",
};

export default function RolesPage() {
  const entries = Object.entries(SYSTEM_ROLE_TEMPLATES);
  const matrix = useMemo(() => buildMatrix(entries), [entries]);
  const [activeRole, setActiveRole] = useState(entries[0]?.[0] ?? "owner");

  const selectedRole = SYSTEM_ROLE_TEMPLATES[activeRole];

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
                <BreadcrumbPage>角色</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="角色与权限"
        description="系统预置角色模板 + 跨角色权限矩阵"
        actions={
          <>
            <Button variant="outline" size="sm">
              <Plus />
              新建角色
            </Button>
          </>
        }
      />

      {/* 角色卡片阵列 */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {entries.map(([code, role]) => {
          const meta = ROLE_ICONS[code] ?? { icon: <UserCog className="h-5 w-5" />, accent: "bg-muted", label: code };
          const active = code === activeRole;
          return (
            <button
              key={code}
              type="button"
              onClick={() => setActiveRole(code)}
              className={[
                "group relative overflow-hidden rounded-xl border bg-card p-4 text-left shadow-sm transition-all",
                active
                  ? "border-primary ring-2 ring-primary/30"
                  : "border-border hover:border-border-strong hover:shadow-md",
              ].join(" ")}
            >
              <div className={["pointer-events-none absolute inset-x-0 -top-px h-0.5", meta.accent].join(" ")} />
              <div className="flex items-start justify-between">
                <span className={["flex h-10 w-10 items-center justify-center rounded-lg text-primary-foreground", meta.accent].join(" ")}>
                  {meta.icon}
                </span>
                <Badge variant={active ? "default" : "soft"}>{code}</Badge>
              </div>
              <div className="mt-3 space-y-1">
                <h3 className="text-base font-semibold">{role.name}</h3>
                <p className="text-xs text-muted-foreground">{role.scopes.length} 条权限</p>
              </div>
            </button>
          );
        })}
      </section>

      {/* 选中角色的权限概览 */}
      {selectedRole ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{selectedRole.name} 角色权限</CardTitle>
                <CardDescription>{activeRole} · 共 {selectedRole.scopes.length} 条作用域</CardDescription>
              </div>
              <div className="flex flex-wrap gap-1">
                {selectedRole.scopes.slice(0, 6).map((scope) => (
                  <Badge key={scope} variant="soft" className="font-mono text-[10px]">
                    {scope}
                  </Badge>
                ))}
                {selectedRole.scopes.length > 6 ? (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    +{selectedRole.scopes.length - 6}
                  </Badge>
                ) : null}
              </div>
            </div>
          </CardHeader>
        </Card>
      ) : null}

      {/* 权限矩阵 */}
      <Card>
        <CardHeader>
          <CardTitle>权限矩阵</CardTitle>
          <CardDescription>行：资源 · 动作 · 列：角色。绿色勾表示该角色拥有该权限。</CardDescription>
        </CardHeader>
        <CardContent className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="border-b border-border">
                  <th className="sticky left-0 z-10 min-w-[160px] bg-muted/40 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    资源 / 动作
                  </th>
                  {entries.map(([code]) => (
                    <th
                      key={code}
                      className="min-w-[120px] px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {ROLE_ICONS[code]?.label ?? code}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map(({ resource, actions }) => (
                  <>
                    <tr key={`${resource}-head`} className="border-b border-border bg-surface-subtle">
                      <td
                        className="sticky left-0 z-10 bg-surface-subtle px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                        colSpan={entries.length + 1}
                      >
                        {RESOURCE_LABELS[resource] ?? resource}
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
                              <span className="text-xs text-muted-foreground">
                                {ACTION_LABELS[action] ?? action}
                              </span>
                            </div>
                          </td>
                          {entries.map(([code, role]) => {
                            const allowed = role.scopes.includes(scope);
                            return (
                              <td key={`${code}-${scope}`} className="px-4 py-2.5 text-center">
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
                  </>
                ))}
              </tbody>
            </table>
          </div>
          <Separator />
          <div className="flex flex-wrap items-center gap-4 px-4 py-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-success-soft text-success">
                <Check className="h-2.5 w-2.5" />
              </span>
              拥有权限
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-muted text-muted-foreground">
                —
              </span>
              无权限
            </span>
            <span>· 共 {matrix.reduce((sum, row) => sum + row.actions.length, 0)} 条权限</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
