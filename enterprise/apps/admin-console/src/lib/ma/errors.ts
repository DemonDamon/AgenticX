import { NextResponse } from "next/server";
import { MA_ERROR_CODES } from "@agenticx/core-api";

import { MaRequestError } from "./http";

export const MA_CONTROL_PLANE_ERROR_CODES = {
  agent_version_conflict: 409,
  agent_slug_conflict: 409,
  environment_name_conflict: 409,
  environment_in_use: 409,
  vault_not_found: 404,
  credential_not_found: 404,
  credential_identity_conflict: 409,
  vault_credential_limit: 409,
  vault_not_archived: 409,
  vault_archived: 409,
  vault_crypto_unavailable: 503,
  memory_store_not_found: 404,
  memory_not_found: 404,
  memory_version_conflict: 409,
  memory_path_conflict: 409,
  memory_store_archived: 409,
  memory_store_not_archived: 409,
  memory_store_in_use: 409,
  memory_version_is_head: 409,
  memory_store_limit: 409,
  schedule_not_found: 404,
  schedule_limit: 409,
  webhook_not_found: 404,
  webhook_limit: 409,
  channel_not_found: 404,
  channel_limit: 409,
  channel_credential_unavailable: 409,
} as const;

export type MaApiErrorCode = keyof typeof MA_ERROR_CODES | keyof typeof MA_CONTROL_PLANE_ERROR_CODES;

function isProtocolCode(code: MaApiErrorCode): code is keyof typeof MA_ERROR_CODES {
  return Object.prototype.hasOwnProperty.call(MA_ERROR_CODES, code);
}

function isControlPlaneCode(code: MaApiErrorCode): code is keyof typeof MA_CONTROL_PLANE_ERROR_CODES {
  return Object.prototype.hasOwnProperty.call(MA_CONTROL_PLANE_ERROR_CODES, code);
}

function statusFor(code: MaApiErrorCode): number {
  if (isProtocolCode(code)) return MA_ERROR_CODES[code];
  if (isControlPlaneCode(code)) return MA_CONTROL_PLANE_ERROR_CODES[code];
  const unreachable: never = code;
  return unreachable;
}

/** 统一体：{"error":{"code","message","details"?}}。 */
export function maError(code: MaApiErrorCode, message: string, details?: Record<string, unknown>): NextResponse {
  const error = details === undefined ? { code, message } : { code, message, details };
  return NextResponse.json({ error }, { status: statusFor(code) });
}

function readStringArray(error: Error, key: "errors"): string[] {
  const value = (error as Error & { errors?: unknown }).errors;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** iam-core / 请求解析错误 → MA 错误。未知错误不回显底层信息。 */
export function maErrorFromException(error: unknown): NextResponse {
  if (error instanceof MaRequestError || (error instanceof Error && error.name === "MaRequestError")) {
    return maError("invalid_request", error instanceof Error ? error.message : "invalid request");
  }
  if (error instanceof Error) {
    switch (error.name) {
      case "AgentValidationError":
      case "MaEnvironmentValidationError":
        return maError("invalid_request", error.message);
      case "AgentNotFoundError":
        return maError("agent_not_found", "agent not found");
      case "AgentVersionNotFoundError":
        return maError("agent_version_not_found", "agent version not found");
      case "MaEnvironmentNotFoundError":
        return maError("environment_not_found", "environment not found");
      case "AgentManifestInvalidError":
        return maError("manifest_invalid", "manifest is invalid", { errors: readStringArray(error, "errors") });
      case "AgentVersionConflictError": {
        const current = (error as Error & { currentLatestVersion?: unknown }).currentLatestVersion;
        return maError("agent_version_conflict", "latest version has changed", {
          current_latest_version: typeof current === "number" ? current : null,
        });
      }
      case "AgentSlugConflictError":
        return maError("agent_slug_conflict", "slug already exists");
      case "MaEnvironmentNameConflictError":
        return maError("environment_name_conflict", "environment name already exists");
      case "MaEnvironmentInUseError":
        return maError("environment_in_use", "environment is referenced by agents or active sessions");
      case "MaVaultValidationError":
      case "MaMemoryValidationError":
        return maError("invalid_request", error.message);
      case "MaVaultNotFoundError":
        return maError("vault_not_found", "vault not found");
      case "MaCredentialNotFoundError":
        return maError("credential_not_found", "credential not found");
      case "MaCredentialIdentityConflictError":
        return maError("credential_identity_conflict", "an active credential with the same identity already exists in this vault");
      case "MaVaultCredentialLimitError":
        return maError("vault_credential_limit", "a vault can hold at most 100 active credentials");
      case "MaVaultNotArchivedError":
        return maError("vault_not_archived", "archive the vault before deleting it");
      case "MaVaultArchivedError":
        return maError("vault_archived", "vault is archived");
      case "VaultCryptoUnavailableError":
        console.error("ma.vault.crypto_unavailable");
        return maError("vault_crypto_unavailable", "credential encryption is not configured");
      case "VaultDecryptError":
        console.error("ma.vault.decrypt_failed", {
          credentialId: (error as Error & { credentialId?: unknown }).credentialId ?? null,
        });
        return maError("internal_error", "internal error");
      case "MaMemoryStoreNotFoundError":
        return maError("memory_store_not_found", "memory store not found");
      case "MaMemoryNotFoundError":
        return maError("memory_not_found", "memory not found");
      case "MaMemoryVersionConflictError": {
        const current = (error as Error & {
          current?: { id?: unknown; path?: unknown; version?: unknown; contentSha256?: unknown } | null;
        }).current;
        const details =
          current && typeof current === "object"
            ? {
                current: {
                  id: typeof current.id === "string" ? current.id : "",
                  path: typeof current.path === "string" ? current.path : "",
                  version: typeof current.version === "number" ? current.version : 0,
                  content_sha256: typeof current.contentSha256 === "string" ? current.contentSha256 : "",
                },
              }
            : { current: null };
        return maError("memory_version_conflict", "memory has been modified", details);
      }
      case "MaMemoryPathConflictError": {
        const conflicting = (error as Error & { conflictingPath?: unknown }).conflictingPath;
        return maError("memory_path_conflict", "path conflicts with an existing memory", {
          conflicting_path: typeof conflicting === "string" ? conflicting : null,
        });
      }
      case "MaMemoryStoreArchivedError":
        return maError("memory_store_archived", "memory store is archived");
      case "MaMemoryStoreNotArchivedError":
        return maError("memory_store_not_archived", "archive the memory store before deleting it");
      case "MaMemoryStoreInUseError":
        return maError("memory_store_in_use", "memory store is mounted by running sessions");
      case "MaMemoryVersionIsHeadError":
        return maError("memory_version_is_head", "cannot redact the current version");
      case "MaMemoryStoreLimitError":
        return maError("memory_store_limit", "memory store limit reached (2000 memories / 20 MiB)");
      case "MaScheduleValidationError":
      case "MaWebhookValidationError":
      case "MaCronValidationError":
        return maError("invalid_request", error.message);
      case "MaScheduleNameConflictError":
      case "MaWebhookNameConflictError":
        return maError("invalid_request", "name already exists");
      case "MaScheduleNotFoundError":
        return maError("schedule_not_found", "schedule not found");
      case "MaScheduleLimitError":
        return maError("schedule_limit", "a tenant can hold at most 100 schedules");
      case "MaWebhookNotFoundError":
        return maError("webhook_not_found", "webhook not found");
      case "MaWebhookLimitError":
        return maError("webhook_limit", "a tenant can hold at most 20 webhooks");
      case "MaChannelValidationError":
        return maError("invalid_request", error.message);
      case "MaChannelConflictError":
        return maError("invalid_request", error.message);
      case "MaChannelNotFoundError":
        return maError("channel_not_found", "channel not found");
      case "MaChannelLimitError":
        return maError("channel_limit", "a tenant can hold at most 20 channels");
      case "MaChannelCredentialUnavailableError":
        return maError("channel_credential_unavailable", "channel credential is unavailable");
      default:
        break;
    }
  }
  console.error("ma.api.internal_error", error);
  return maError("internal_error", "internal error");
}
