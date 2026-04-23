import type { ReactNode } from "react";
import { requireAdminPageSession } from "../../lib/admin-page-guard";

export default async function AuditLayout({ children }: { children: ReactNode }) {
  await requireAdminPageSession();
  return <>{children}</>;
}

