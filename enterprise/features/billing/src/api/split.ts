import type { BillingSplitRuleInput, ReconcileQueryInput, SettlementContractNotifyInput } from "../types";
import { SplitRulesService } from "../services/split-rules";
import { SplitLedgerService } from "../services/split-ledger";
import { SettlementContractService } from "../services/settlement-contract";
import { reconcileRowsToCsv } from "../services/split-utils";

export class BillingSplitApi {
  private readonly rules: SplitRulesService;
  private readonly ledger: SplitLedgerService;
  private readonly settlement: SettlementContractService;

  public constructor(services?: {
    rules?: SplitRulesService;
    ledger?: SplitLedgerService;
    settlement?: SettlementContractService;
  }) {
    this.settlement = services?.settlement ?? new SettlementContractService();
    this.rules = services?.rules ?? new SplitRulesService();
    this.ledger = services?.ledger ?? new SplitLedgerService(undefined, this.rules, this.settlement);
  }

  public async listRules(tenantId: string) {
    const items = await this.rules.listRules(tenantId);
    return { code: "00000", message: "ok", data: { items } };
  }

  public async createRule(input: BillingSplitRuleInput) {
    const item = await this.rules.createRule(input);
    return { code: "00000", message: "ok", data: { item } };
  }

  public async updateRule(tenantId: string, id: string, patch: Partial<Omit<BillingSplitRuleInput, "tenant_id">>) {
    const item = await this.rules.updateRule(tenantId, id, patch);
    if (!item) return { code: "40401", message: "rule not found", data: null };
    return { code: "00000", message: "ok", data: { item } };
  }

  public async deleteRule(tenantId: string, id: string) {
    const deleted = await this.rules.deleteRule(tenantId, id);
    if (!deleted) return { code: "40401", message: "rule not found", data: null };
    return { code: "00000", message: "ok", data: { deleted: true } };
  }

  public async reconcile(input: ReconcileQueryInput) {
    const data = await this.ledger.reconcile(input);
    return { code: "00000", message: "ok", data };
  }

  public async reconcileCsv(input: ReconcileQueryInput) {
    const data = await this.ledger.reconcile(input);
    return reconcileRowsToCsv(data.rows);
  }

  public async syncPending(tenantId: string, limit?: number) {
    const synced = await this.ledger.syncPendingUsage(tenantId, limit ?? 200);
    return { code: "00000", message: "ok", data: { synced } };
  }

  public async getWebhookConfig(tenantId: string) {
    const config = await this.settlement.getConfig(tenantId);
    return { code: "00000", message: "ok", data: { config } };
  }

  public async setWebhookConfig(tenantId: string, input: { webhook_url?: string | null; enabled?: boolean }) {
    const config = await this.settlement.setConfig(tenantId, input);
    return { code: "00000", message: "ok", data: { config } };
  }

  public async listWebhookEvents(tenantId: string, limit?: number) {
    const items = await this.settlement.listEvents(tenantId, limit ?? 50);
    return { code: "00000", message: "ok", data: { items } };
  }

  public async notifySplit(input: SettlementContractNotifyInput) {
    const result = await this.settlement.notifySplit(input);
    return { code: "00000", message: "ok", data: result };
  }
}
