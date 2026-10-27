import type { MaWebhookResourceEventType } from "@agenticx/core-api";
import { ulid } from "ulid";

import { runtimeInternal } from "./runtime-internal-client";

const EMIT_TIMEOUT_MS = 2_000;

function resourceType(type: MaWebhookResourceEventType): string {
  switch (type) {
    case "agent.created":
    case "agent.version_published":
    case "agent.deleted":
      return "agent";
    case "environment.created":
    case "environment.updated":
    case "environment.deleted":
      return "environment";
    case "vault.created":
    case "vault.archived":
    case "vault.deleted":
      return "vault";
    case "vault_credential.created":
    case "vault_credential.archived":
    case "vault_credential.deleted":
      return "vault_credential";
    case "memory_store.created":
    case "memory_store.archived":
    case "memory_store.deleted":
      return "memory_store";
    case "schedule.created":
    case "schedule.updated":
    case "schedule.deleted":
      return "schedule";
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

function withTimeout<T>(pending: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    pending.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** 管理台资源写库成功后通知运行时入队。失败只记日志，不阻塞响应。 */
export function emitMaResourceEvent(input: {
  tenantId: string;
  type: MaWebhookResourceEventType;
  resourceId: string;
  extra?: { agent_id?: string; vault_id?: string; version?: number };
}): void {
  if (process.env.MA_WEBHOOK_EVENTS_ENABLED === "0") return;
  const body = {
    id: ulid(),
    tenant_id: input.tenantId,
    type: input.type,
    resource_type: resourceType(input.type),
    resource_id: input.resourceId,
    occurred_at: new Date().toISOString(),
    ...input.extra,
  };
  void withTimeout(runtimeInternal("POST", "/internal/ma/webhook-events", body), EMIT_TIMEOUT_MS).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[ma-webhook-event] ${message}`);
  });
}
