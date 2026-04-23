import { Separator } from "@agenticx/ui";
import Link from "next/link";
import type { ReactNode } from "react";

const navItems = [
  { href: "/iam/users", label: "用户管理" },
  { href: "/iam/departments", label: "部门管理" },
  { href: "/iam/roles", label: "角色权限" },
  { href: "/iam/bulk-import", label: "批量导入" },
  { href: "/audit", label: "审计日志" },
  { href: "/metering", label: "四维查询" },
];

export default function IamLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen">
      <aside className="w-60 border-r border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="mb-4 text-base font-semibold">AgenticX Admin</h1>
        <nav className="space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <section className="flex min-h-screen flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-sm font-medium">后台管理台 · IAM</div>
          <div className="text-xs text-zinc-500">tenant: tenant_default · user: super-admin</div>
        </header>
        <Separator />
        <div className="flex-1 p-6">{children}</div>
      </section>
    </main>
  );
}

