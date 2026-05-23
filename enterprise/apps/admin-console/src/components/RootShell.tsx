"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AdminSessionGuard } from "./AdminSessionGuard";
import { AppShell } from "./AppShell";

export function RootShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") {
    return <>{children}</>;
  }
  return (
    <>
      <AdminSessionGuard />
      <AppShell>{children}</AppShell>
    </>
  );
}

