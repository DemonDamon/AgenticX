/**
 * ECP E2 · 货架生命周期（draft → published → deprecated）
 *
 * 与租户侧 `active`/`disabled` 开关并存：shelf 管「能否进入分配/bootstrap」，
 * status 管「企业是否启用该行」。
 */

export type ShelfStatus = "draft" | "published" | "deprecated";
export type ScanVerdict = "safe" | "caution" | "dangerous" | null;

export class ShelfPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShelfPublishError";
  }
}

export function isShelfPublished(shelfStatus: string | null | undefined): boolean {
  return shelfStatus === "published";
}

/** 发布前 scan 门禁：dangerous 与未扫描均不可发布。 */
export function assertScanAllowsPublish(scanVerdict: ScanVerdict): void {
  if (scanVerdict === null || scanVerdict === undefined) {
    throw new ShelfPublishError("publish requires a completed security scan");
  }
  if (scanVerdict === "dangerous") {
    throw new ShelfPublishError("dangerous scan verdict cannot be published");
  }
}

/** 平台目录更新是否应推送到仍 granted 的租户。 */
export function shouldPushCatalogUpdateToTenant(
  grantStatus: "granted" | "revoked" | undefined,
  shelfStatus: string | null | undefined,
): boolean {
  return grantStatus === "granted" && isShelfPublished(shelfStatus);
}

/** 租户 skill 是否可进入 Portal/bootstrap（不含 scan 与 pack 分配判定）。 */
export function skillShelfAllowsBootstrap(
  shelfStatus: string | null | undefined,
  capabilityStatus: string | null | undefined,
): boolean {
  return isShelfPublished(shelfStatus) && capabilityStatus === "active";
}

/** 迁移 E1 `active`/`disabled` 到 shelf 语义（一次性 SQL 与读路径兼容）。 */
export function legacyCatalogStatusToShelf(status: string | null | undefined): ShelfStatus {
  if (status === "disabled") return "deprecated";
  if (status === "active") return "published";
  return "draft";
}
