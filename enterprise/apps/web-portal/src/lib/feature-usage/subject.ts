/**
 * Identity a feature ceiling is resolved against.
 *
 * Roles and group membership are read on each request so the badge and the
 * gate see the same answer.
 */

import { getUserRolesDetail, listUserGroupIdsForUser } from "@agenticx/iam-core";

import type { FeatureUsageSubjectContext } from "./gate";

export type FeatureUsageSession = {
  tenantId: string;
  userId: string;
  deptId?: string | null;
  scopes: readonly string[];
};

async function readRoleCodes(session: { tenantId: string; userId: string }): Promise<string[]> {
  try {
    const { roleCodes } = await getUserRolesDetail(session.tenantId, session.userId);
    return roleCodes.map((code) => String(code ?? "").trim()).filter(Boolean);
  } catch {
    // An unreadable role table resolves to the catch-all default, which is the
    // stricter answer, rather than whichever configured role is most generous.
    return [];
  }
}

export async function featureUsageSubject(
  session: FeatureUsageSession,
): Promise<FeatureUsageSubjectContext> {
  const [roles, groupIds] = await Promise.all([
    readRoleCodes(session),
    listUserGroupIdsForUser(session.tenantId, session.userId),
  ]);
  return {
    tenantId: session.tenantId,
    userId: session.userId,
    deptId: session.deptId ?? null,
    roles,
    groupIds,
  };
}
