/**
 * ECP · 稳定错误码与异常类映射（供 API 与文档对齐）
 */

export const ECP_ERROR_CODES = {
  /** 发布/上架需已完成审批（E3） */
  APPROVAL_REQUIRED: "approval_required",
  /** 货架 scan 未通过或未完成（E2） */
  SHELF_PUBLISH_BLOCKED: "shelf_publish_blocked",
  /** 租户侧修改平台下发 skill 元数据（E1） */
  PLATFORM_SKILL_METADATA_READONLY: "platform_skill_metadata_readonly",
  /** 租户侧修改平台下发 pack 元数据（E4） */
  PLATFORM_PACK_METADATA_READONLY: "platform_pack_metadata_readonly",
  /** 专家包 manifest 结构非法（E4） */
  EXPERT_PACKAGE_MANIFEST_INVALID: "expert_package_manifest_invalid",
  /** grant 目标未 published（E2） */
  CATALOG_NOT_PUBLISHED: "catalog_not_published",
  /** 平台租户环境未配置（E4 sync） */
  PLATFORM_TENANT_UNCONFIGURED: "platform_tenant_unconfigured",
  /** 审批工作流配置或步骤非法（E3） */
  APPROVAL_WORKFLOW_INVALID: "approval_workflow_invalid",
} as const;

export type EcpErrorCode = (typeof ECP_ERROR_CODES)[keyof typeof ECP_ERROR_CODES];

/** 将已知 Error.name / code 映射为对外 error code。 */
export function resolveEcpErrorCode(error: unknown): EcpErrorCode | "unknown" {
  if (!error || typeof error !== "object") return "unknown";
  const record = error as { name?: string; code?: string; message?: string };
  if (record.code === ECP_ERROR_CODES.APPROVAL_REQUIRED) {
    return ECP_ERROR_CODES.APPROVAL_REQUIRED;
  }
  switch (record.name) {
    case "ApprovalRequiredError":
      return ECP_ERROR_CODES.APPROVAL_REQUIRED;
    case "ShelfPublishError":
      return ECP_ERROR_CODES.SHELF_PUBLISH_BLOCKED;
    case "PlatformSkillMetadataReadonlyError":
      return ECP_ERROR_CODES.PLATFORM_SKILL_METADATA_READONLY;
    case "PlatformPackMetadataReadonlyError":
      return ECP_ERROR_CODES.PLATFORM_PACK_METADATA_READONLY;
    case "ExpertPackageManifestError":
      return ECP_ERROR_CODES.EXPERT_PACKAGE_MANIFEST_INVALID;
    case "ApprovalWorkflowError":
      return ECP_ERROR_CODES.APPROVAL_WORKFLOW_INVALID;
    default:
      if (typeof record.message === "string") {
        if (/ECP_PLATFORM_TENANT_ID|DEFAULT_TENANT_ID is required/i.test(record.message)) {
          return ECP_ERROR_CODES.PLATFORM_TENANT_UNCONFIGURED;
        }
        if (/must be published before grant/i.test(record.message)) {
          return ECP_ERROR_CODES.CATALOG_NOT_PUBLISHED;
        }
      }
      return "unknown";
  }
}
