import { NextResponse } from "next/server";
import type { MaChannel, MaChannelConnection, MaChannelConversation } from "@agenticx/iam-core";

import { automationErrorResponse } from "../../app/api/admin/ma-schedules/shared";

export type ChannelWithConnection = MaChannel & { connection: MaChannelConnection };

export function toMaChannelRecord(channel: ChannelWithConnection) {
  return {
    id: channel.id,
    tenant_id: channel.tenantId,
    name: channel.name,
    platform: channel.platform,
    agent_id: channel.agentId,
    routing: channel.routing,
    pinned_version: channel.pinnedVersion,
    environment_id: channel.environmentId,
    app_id: channel.appId,
    credential: { vault_id: channel.credentialVaultId, credential_id: channel.credentialId },
    owner_user_id: channel.ownerUserId,
    config: channel.config,
    enabled: channel.enabled,
    revision: channel.revision,
    connection: {
      status: channel.connection.status,
      last_error: channel.connection.lastError,
      last_event_at: channel.connection.lastEventAt,
      started_at: channel.connection.startedAt,
    },
    created_at: channel.createdAt,
    updated_at: channel.updatedAt,
  };
}

export function toMaChannelRuntimeRecord(channel: MaChannel) {
  return {
    id: channel.id,
    tenant_id: channel.tenantId,
    name: channel.name,
    platform: channel.platform,
    agent_id: channel.agentId,
    routing: channel.routing,
    pinned_version: channel.pinnedVersion,
    environment_id: channel.environmentId,
    app_id: channel.appId,
    owner_user_id: channel.ownerUserId,
    config: channel.config,
    revision: channel.revision,
  };
}

export function toMaChannelConversationRecord(row: MaChannelConversation) {
  return {
    conversation_key: row.conversationKey,
    conversation_type: row.conversationType,
    session_id: row.sessionId,
    agent_version: row.agentVersion,
    last_message_at: row.lastMessageAt,
  };
}

export function channelAdminError(error: unknown): NextResponse {
  if (error instanceof Error) {
    switch (error.name) {
      case "MaChannelValidationError":
      case "MaChannelConflictError":
        return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
      case "MaChannelNotFoundError":
        return NextResponse.json({ code: "40400", message: "渠道不存在" }, { status: 404 });
      case "MaChannelLimitError":
        return NextResponse.json({ code: "40900", message: "每个租户最多 20 个 IM 渠道" }, { status: 409 });
      case "MaChannelCredentialUnavailableError":
        return NextResponse.json({ code: "40900", message: "渠道凭证不可用" }, { status: 409 });
      case "VaultCryptoUnavailableError":
        return NextResponse.json({ code: "50300", message: "凭证加密未配置" }, { status: 503 });
      default:
        break;
    }
  }
  return automationErrorResponse(error);
}
