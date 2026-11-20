/**
 * ECP E1 revoke / sync 判定（纯函数，便于两租户场景单测）。
 */
import {
  shouldPushCatalogUpdateToTenant as shouldPushCatalogUpdate,
  type ShelfStatus,
} from "@agenticx/config";

import type { GrantStatus, RevokePolicy } from "./platform-catalog-store";

export function shouldPushCatalogUpdateToTenant(
  grantStatus: GrantStatus | undefined,
  shelfStatus: ShelfStatus | string | undefined = "published",
): boolean {
  return shouldPushCatalogUpdate(grantStatus, shelfStatus);
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
