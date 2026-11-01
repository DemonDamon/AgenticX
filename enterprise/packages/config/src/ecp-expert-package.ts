/**
 * ECP E4 · 专家包（expert_package）与租户分发策略（安装副本开关，默认关）
 */

export type EcpRevokePolicy = "retain_stop_updates" | "strip_bootstrap";

export const CATALOG_RESOURCE_SKILL = "skill" as const;
export const CATALOG_RESOURCE_EXPERT_PACKAGE = "expert_package" as const;

export type CatalogResourceType =
  | typeof CATALOG_RESOURCE_SKILL
  | typeof CATALOG_RESOURCE_EXPERT_PACKAGE;

export type ExpertPackageMemberKind = "skill" | "mcp";

export type ExpertPackageMemberRef = {
  kind: ExpertPackageMemberKind;
  /** 平台侧 `skill:<ulid>` / `mcp:<ulid>`（创建目录版本时写入 manifest） */
  capabilityId: string;
};

export type ExpertPackageManifest = {
  members: ExpertPackageMemberRef[];
};

export type EcpTenantDistributionPolicy = {
  /** 开启后 grant 时物化租户自有副本；默认 false = 纯授权引用下发。 */
  installCopyEnabled: boolean;
};

export const DEFAULT_ECP_TENANT_DISTRIBUTION_POLICY: EcpTenantDistributionPolicy = {
  installCopyEnabled: false,
};

export type ExpertPackageRevokeEffect = {
  stopCatalogUpdates: boolean;
  disablePlatformReferences: boolean;
  disableInstallCopies: boolean;
};

export class ExpertPackageManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpertPackageManifestError";
  }
}

function isMemberKind(value: unknown): value is ExpertPackageMemberKind {
  return value === "skill" || value === "mcp";
}

export function normalizeExpertPackageManifest(raw: unknown): ExpertPackageManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ExpertPackageManifestError("pack manifest must be an object");
  }
  const source = raw as Record<string, unknown>;
  const membersRaw = source.members;
  if (!Array.isArray(membersRaw) || membersRaw.length === 0) {
    throw new ExpertPackageManifestError("pack manifest requires at least one member");
  }
  const members: ExpertPackageMemberRef[] = [];
  for (const entry of membersRaw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ExpertPackageManifestError("invalid manifest member");
    }
    const row = entry as Record<string, unknown>;
    if (!isMemberKind(row.kind)) {
      throw new ExpertPackageManifestError("member kind must be skill or mcp");
    }
    const capabilityId = String(row.capabilityId ?? "").trim();
    if (!capabilityId.startsWith(`${row.kind}:`)) {
      throw new ExpertPackageManifestError(`capabilityId must match kind prefix for ${row.kind}`);
    }
    members.push({ kind: row.kind, capabilityId });
  }
  return { members };
}

export function normalizeEcpTenantDistributionPolicy(raw: unknown): EcpTenantDistributionPolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_ECP_TENANT_DISTRIBUTION_POLICY };
  }
  const source = raw as Record<string, unknown>;
  return {
    installCopyEnabled: source.installCopyEnabled === true,
  };
}

export function isExpertPackageResourceType(resourceType: string | null | undefined): boolean {
  return resourceType === CATALOG_RESOURCE_EXPERT_PACKAGE;
}

/** 审核资源类型 expert_package 与 platform_catalog_item 共用同一 catalog 行。 */
export function approvalResourceTypeForCatalog(
  resourceType: CatalogResourceType,
): "platform_catalog_item" | "platform_catalog_version" {
  if (resourceType === CATALOG_RESOURCE_EXPERT_PACKAGE) {
    return "platform_catalog_item";
  }
  return "platform_catalog_item";
}

export function resolveExpertPackageRevokeEffect(input: {
  installCopyEnabled: boolean;
  revokePolicy: EcpRevokePolicy;
}): ExpertPackageRevokeEffect {
  const stopCatalogUpdates = true;
  if (input.revokePolicy === "strip_bootstrap") {
    return {
      stopCatalogUpdates,
      disablePlatformReferences: true,
      disableInstallCopies: true,
    };
  }
  if (input.installCopyEnabled) {
    return {
      stopCatalogUpdates,
      disablePlatformReferences: false,
      disableInstallCopies: false,
    };
  }
  return {
    stopCatalogUpdates,
    disablePlatformReferences: false,
    disableInstallCopies: false,
  };
}

export type CatalogLibraryLayer = "platform_catalog" | "org_library";

export function catalogItemLibraryLayer(
  resourceType: string,
  viewer: "platform_operator" | "tenant_admin",
): CatalogLibraryLayer {
  if (viewer === "platform_operator") return "platform_catalog";
  return isExpertPackageResourceType(resourceType) || resourceType === CATALOG_RESOURCE_SKILL
    ? "org_library"
    : "org_library";
}
