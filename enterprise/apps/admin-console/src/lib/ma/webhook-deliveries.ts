import { runtimeInternal } from "./runtime-internal-client";
import { MA_WEBHOOK_DELIVERY_RECORD_KEYS } from "./webhook-records";

type DeliveryKey = (typeof MA_WEBHOOK_DELIVERY_RECORD_KEYS)[number];
type DeliveryRecord = Record<DeliveryKey, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickDelivery(row: Record<string, unknown>): DeliveryRecord {
  const record = {} as DeliveryRecord;
  for (const key of MA_WEBHOOK_DELIVERY_RECORD_KEYS) {
    record[key] = row[key] ?? null;
  }
  return record;
}

export async function listWebhookDeliveriesFromRuntime(
  tenantId: string,
  webhookId: string,
  limit: number,
): Promise<DeliveryRecord[]> {
  const query = new URLSearchParams({ tenant_id: tenantId, limit: String(limit) });
  const payload = await runtimeInternal<{ data?: unknown }>(
    "GET",
    `/internal/ma/webhooks/${encodeURIComponent(webhookId)}/deliveries?${query.toString()}`,
  );
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("runtime deliveries payload is invalid");
  }
  return payload.data.filter(isRecord).map(pickDelivery);
}
