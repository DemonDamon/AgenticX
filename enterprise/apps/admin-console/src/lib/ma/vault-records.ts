import type { MaCredential, MaCredentialType, MaNetworking, MaVault } from "@agenticx/iam-core";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNetworking(value: unknown): MaNetworking | null {
  if (!isRecord(value)) return null;
  if (value.type === "unrestricted") return { type: "unrestricted" };
  if (value.type === "limited" && Array.isArray(value.allowed_hosts) && value.allowed_hosts.every((item) => typeof item === "string")) {
    return { type: "limited", allowed_hosts: value.allowed_hosts };
  }
  return null;
}

function readRefreshPublic(value: unknown): {
  token_endpoint: string;
  client_id: string;
  scope: string | null;
  resource: string | null;
  token_endpoint_auth_type: "none" | "client_secret_basic" | "client_secret_post";
} | null {
  if (!isRecord(value)) return null;
  const authType = value.token_endpoint_auth_type;
  if (typeof value.token_endpoint !== "string" || typeof value.client_id !== "string") return null;
  if (authType !== "none" && authType !== "client_secret_basic" && authType !== "client_secret_post") return null;
  return {
    token_endpoint: value.token_endpoint,
    client_id: value.client_id,
    scope: typeof value.scope === "string" ? value.scope : null,
    resource: typeof value.resource === "string" ? value.resource : null,
    token_endpoint_auth_type: authType,
  };
}

export type VaultRecord = {
  id: string;
  tenant_id: string;
  display_name: string;
  description: string | null;
  metadata: Record<string, string>;
  status: "active" | "archived";
  credential_count: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type CredentialAuthPublic =
  | { type: "static_bearer"; mcp_server_url: string }
  | { type: "bearer"; host: string }
  | { type: "environment_variable"; secret_name: string; networking: MaNetworking }
  | {
      type: "mcp_oauth";
      mcp_server_url: string;
      expires_at: string | null;
      refresh:
        | null
        | {
            token_endpoint: string;
            client_id: string;
            scope: string | null;
            resource: string | null;
            token_endpoint_auth: { type: "none" | "client_secret_basic" | "client_secret_post" };
            has_refresh_token: boolean;
            has_client_secret: boolean;
          };
    };

export type CredentialRecord = {
  id: string;
  vault_id: string;
  display_name: string | null;
  type: MaCredentialType;
  status: "active" | "archived";
  has_secret: boolean;
  expires_at: string | null;
  last_rotated_at: string | null;
  last_resolved_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  auth: CredentialAuthPublic;
};

export function toVaultRecord(vault: MaVault): VaultRecord {
  return {
    id: vault.id,
    tenant_id: vault.tenantId,
    display_name: vault.displayName,
    description: vault.description,
    metadata: vault.metadata,
    status: vault.status,
    credential_count: vault.credentialCount,
    created_at: vault.createdAt,
    updated_at: vault.updatedAt,
    archived_at: vault.archivedAt,
  };
}

function authOf(credential: MaCredential): CredentialAuthPublic {
  switch (credential.type) {
    case "static_bearer":
      return { type: "static_bearer", mcp_server_url: credential.identityKey };
    case "bearer":
      return { type: "bearer", host: credential.identityKey };
    case "environment_variable": {
      const networking = readNetworking(credential.publicConfig.networking);
      if (!networking) throw new Error("invalid credential networking");
      return { type: "environment_variable", secret_name: credential.identityKey, networking };
    }
    case "mcp_oauth": {
      const refresh = readRefreshPublic(credential.publicConfig.refresh);
      return {
        type: "mcp_oauth",
        mcp_server_url: credential.identityKey,
        expires_at: credential.expiresAt,
        refresh: refresh
          ? {
              token_endpoint: refresh.token_endpoint,
              client_id: refresh.client_id,
              scope: refresh.scope,
              resource: refresh.resource,
              token_endpoint_auth: { type: refresh.token_endpoint_auth_type },
              has_refresh_token: credential.secretFields.includes("refresh_token"),
              has_client_secret: credential.secretFields.includes("client_secret"),
            }
          : null,
      };
    }
    default: {
      const unreachable: never = credential.type;
      throw new Error(String(unreachable));
    }
  }
}

export function toCredentialRecord(credential: MaCredential): CredentialRecord {
  return {
    id: credential.id,
    vault_id: credential.vaultId,
    display_name: credential.displayName,
    type: credential.type,
    status: credential.status,
    has_secret: credential.hasSecret,
    expires_at: credential.expiresAt,
    last_rotated_at: credential.lastRotatedAt,
    last_resolved_at: credential.lastResolvedAt,
    created_at: credential.createdAt,
    updated_at: credential.updatedAt,
    archived_at: credential.archivedAt,
    auth: authOf(credential),
  };
}
