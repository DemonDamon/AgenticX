import type { MaWebhook, MaWebhookDelivery } from "@agenticx/iam-core";

const WEBHOOK_KEYS = [
  "id",
  "tenant_id",
  "name",
  "description",
  "url",
  "event_types",
  "agent_ids",
  "sources",
  "include_result_text",
  "enabled",
  "disabled_reason",
  "disabled_at",
  "secret_rotated_at",
  "created_at",
  "updated_at",
] as const;

const DELIVERY_KEYS = [
  "id",
  "webhook_id",
  "event_id",
  "event_type",
  "status",
  "attempts",
  "next_attempt_at",
  "last_status_code",
  "last_error",
  "delivered_at",
  "created_at",
] as const;

export function toMaWebhookRecord(webhook: MaWebhook): Record<(typeof WEBHOOK_KEYS)[number], unknown> {
  return {
    id: webhook.id,
    tenant_id: webhook.tenantId,
    name: webhook.name,
    description: webhook.description ?? "",
    url: webhook.url,
    event_types: webhook.eventTypes,
    agent_ids: webhook.agentIds,
    sources: webhook.sources,
    include_result_text: webhook.includeResultText,
    enabled: webhook.enabled,
    disabled_reason: webhook.disabledReason ?? null,
    disabled_at: webhook.disabledAt ?? null,
    secret_rotated_at: webhook.secretRotatedAt,
    created_at: webhook.createdAt,
    updated_at: webhook.updatedAt,
  };
}

export function toMaWebhookDeliveryRecord(
  delivery: MaWebhookDelivery,
): Record<(typeof DELIVERY_KEYS)[number], unknown> {
  return {
    id: delivery.id,
    webhook_id: delivery.webhookId,
    event_id: delivery.eventId,
    event_type: delivery.eventType,
    status: delivery.status,
    attempts: delivery.attempts,
    next_attempt_at: delivery.nextAttemptAt,
    last_status_code: delivery.lastStatusCode,
    last_error: delivery.lastError,
    delivered_at: delivery.deliveredAt,
    created_at: delivery.createdAt,
  };
}

export const MA_WEBHOOK_RECORD_KEYS = WEBHOOK_KEYS;
export const MA_WEBHOOK_DELIVERY_RECORD_KEYS = DELIVERY_KEYS;
