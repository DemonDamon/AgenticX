import { BillingSplitApi, type BillingSplitRuleInput } from "@agenticx/feature-billing";
import { MeteringService, type UsageRecordInput } from "@agenticx/feature-metering";

const meteringService = new MeteringService();
const billingSplitApi = new BillingSplitApi();

const FALLBACK_TENANT_ID = "01J00000000000000000000001";

function resolveTenantId(): string {
  const value = process.env.DEFAULT_TENANT_ID?.trim();
  return value && value.length > 0 ? value : FALLBACK_TENANT_ID;
}

export function getBillingSplitApi() {
  return billingSplitApi;
}

export async function recordUsageAndSplit(input: Omit<UsageRecordInput, "tenant_id">) {
  const tenantId = resolveTenantId();
  const written = await meteringService.recordUsage({ tenant_id: tenantId, ...input });
  if (!written) {
    return { code: "50001", message: "usage write failed", data: null };
  }
  await billingSplitApi.syncPending(tenantId, 1);
  return { code: "00000", message: "ok", data: { usage: written } };
}

export async function listSplitRules() {
  return billingSplitApi.listRules(resolveTenantId());
}

export async function createSplitRule(input: Omit<BillingSplitRuleInput, "tenant_id">) {
  return billingSplitApi.createRule({ tenant_id: resolveTenantId(), ...input });
}

export async function updateSplitRule(id: string, patch: Parameters<BillingSplitApi["updateRule"]>[2]) {
  return billingSplitApi.updateRule(resolveTenantId(), id, patch);
}

export async function deleteSplitRule(id: string) {
  return billingSplitApi.deleteRule(resolveTenantId(), id);
}

export async function reconcileSplit(input: Omit<Parameters<BillingSplitApi["reconcile"]>[0], "tenant_id">) {
  return billingSplitApi.reconcile({ tenant_id: resolveTenantId(), ...input });
}

export async function exportReconcileCsv(input: Omit<Parameters<BillingSplitApi["reconcileCsv"]>[0], "tenant_id">) {
  return billingSplitApi.reconcileCsv({ tenant_id: resolveTenantId(), ...input });
}

export async function syncPendingSplit(limit?: number) {
  return billingSplitApi.syncPending(resolveTenantId(), limit);
}

export async function getSettlementWebhookConfig() {
  return billingSplitApi.getWebhookConfig(resolveTenantId());
}

export async function setSettlementWebhookConfig(input: { webhook_url?: string | null; enabled?: boolean }) {
  return billingSplitApi.setWebhookConfig(resolveTenantId(), input);
}

export async function listSettlementWebhookEvents(limit?: number) {
  return billingSplitApi.listWebhookEvents(resolveTenantId(), limit);
}
