import { getAdminUser, type ProjectVisibility } from "@agenticx/iam-core";
import type { AdminSession } from "./admin-auth";

export const PROJECT_READ_SCOPES = ["audit:read:all", "audit:read:dept", "audit:manage"] as const;

export async function resolveProjectVisibility(
  session: AdminSession,
  scopes: readonly string[],
): Promise<ProjectVisibility> {
  const granted = new Set(scopes);
  if (granted.has("*") || granted.has("audit:manage") || granted.has("audit:read:all")) {
    return { mode: "all" };
  }
  if (granted.has("audit:read:dept")) {
    const user = await getAdminUser(session.tenantId, session.userId);
    return { mode: "dept", deptId: user?.deptId ?? "" };
  }
  return { mode: "self", userId: session.userId };
}
