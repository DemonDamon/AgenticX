/**
 * ECP E1 revoke / sync 判定（纯函数，便于两租户场景单测）。
 */
import type { GrantStatus, RevokePolicy } from "../db-stores/postgresql/platform-catalog-store";

export function shouldPushCatalogUpdateToTenant(grantStatus: GrantStatus | undefined): boolean {
  return grantStatus === "granted";
}

export function tenantSkillStatusAfterRevoke(
  policy: RevokePolicy,
  previousStatus: "active" | "disabled" = "active",
): "active" | "disabled" {
  if (policy === "strip_bootstrap") return "disabled";
  return previousStatus;
}

export function tenantSeesCatalogSkill(
  tenantId: string,
  ownerTenantId: string | null,
): boolean {
  return Boolean(ownerTenantId && ownerTenantId === tenantId);
}
