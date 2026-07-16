import { ulid } from "ulid";
import type {
  BillingSplitLedgerEntry,
  BillingSplitRule,
  ReconcileQueryInput,
  ReconcileResult,
  UsageRecordForSplit,
} from "../types";
import { costUsdToMicro, microToUsdString, splitAmountMicro } from "./split-utils";
import { SplitRulesService } from "./split-rules";
import type { SettlementContractService } from "./settlement-contract";
import { createBillingSqlExecutor, type BillingSqlExecutor } from "./sql";

export class SplitLedgerService {
  private readonly db: BillingSqlExecutor;
  private readonly rules: SplitRulesService;
  private settlement?: SettlementContractService;

  public constructor(connectionString?: string, rules?: SplitRulesService, settlement?: SettlementContractService) {
    this.db = createBillingSqlExecutor(connectionString);
    this.rules = rules ?? new SplitRulesService(connectionString);
    this.settlement = settlement;
  }

  public setSettlementService(service: SettlementContractService): void {
    this.settlement = service;
  }

  public async listLedgerEntries(
    tenantId: string,
    input: { start: string; end: string; participant_id?: string; limit?: number }
  ): Promise<BillingSplitLedgerEntry[]> {
    const where = ["tenant_id = $1", "time_bucket >= $2", "time_bucket <= $3"];
    const params: Array<string | number> = [tenantId, input.start, input.end];
    if (input.participant_id) {
      params.push(input.participant_id);
      where.push(`participant_id = $${params.length}`);
    }
    const limit = input.limit ?? 500;
    try {
      const result = await this.db.query(
        `
          select *
          from billing_split_ledger
          where ${where.join(" and ")}
          order by time_bucket desc, participant_id asc
          limit ${limit}
        `,
        params
      );
      return result.rows.map((row) => this.mapLedger(row));
    } catch {
      return [];
    }
  }

  public async syncPendingUsage(tenantId: string, limit = 100): Promise<number> {
    let rows: UsageRecordForSplit[] = [];
    try {
      const result = await this.db.query(
        `
          select ur.id, ur.tenant_id, ur.cost_usd, ur.time_bucket, ur.provider, ur.model
          from usage_records ur
          left join billing_split_ledger bl on bl.usage_record_id = ur.id
          where ur.tenant_id = $1 and bl.id is null
          order by ur.created_at asc
          limit $2
        `,
        [tenantId, limit]
      );
      rows = result.rows.map((row) => ({
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        cost_usd: Number(row.cost_usd ?? 0),
        time_bucket: row.time_bucket instanceof Date ? row.time_bucket.toISOString() : String(row.time_bucket),
        provider: row.provider == null ? null : String(row.provider),
        model: row.model == null ? null : String(row.model),
      }));
    } catch {
      return 0;
    }

    let synced = 0;
    for (const usage of rows) {
      const applied = await this.applySplitForUsage(usage);
      if (applied) synced += 1;
    }
    return synced;
  }

  public async applySplitForUsage(usage: UsageRecordForSplit): Promise<boolean> {
    const existing = await this.db.query(`select id from billing_split_ledger where usage_record_id = $1 limit 1`, [
      usage.id,
    ]);
    if ((existing.rowCount ?? 0) > 0) {
      return false;
    }

    const rule = await this.rules.findActiveRule(usage.tenant_id, usage.time_bucket);
    if (!rule) {
      return false;
    }

    const totalMicro = costUsdToMicro(usage.cost_usd);
    if (totalMicro <= 0n) {
      return false;
    }

    const participants = this.resolveParticipants(rule, usage);
    const shares = splitAmountMicro(totalMicro, participants);
    if (shares.length === 0) {
      return false;
    }

    const ruleVersion = rule.updated_at;
    const entries: BillingSplitLedgerEntry[] = [];
    for (const share of shares) {
      const id = ulid();
      await this.db.query(
        `
          insert into billing_split_ledger
            (id, tenant_id, usage_record_id, rule_id, rule_version, participant_id, participant_label,
             amount_micro_usd, original_cost_micro_usd, time_bucket, created_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
        `,
        [
          id,
          usage.tenant_id,
          usage.id,
          rule.id,
          ruleVersion,
          share.participant_id,
          share.label ?? null,
          share.amount_micro.toString(),
          totalMicro.toString(),
          usage.time_bucket,
        ]
      );
      entries.push({
        id,
        tenant_id: usage.tenant_id,
        usage_record_id: usage.id,
        rule_id: rule.id,
        rule_version: ruleVersion,
        participant_id: share.participant_id,
        participant_label: share.label ?? null,
        amount_micro_usd: share.amount_micro.toString(),
        original_cost_micro_usd: totalMicro.toString(),
        time_bucket: usage.time_bucket,
        created_at: new Date().toISOString(),
      });
    }

    if (this.settlement) {
      await this.settlement.notifySplit({
        tenant_id: usage.tenant_id,
        usage_record_id: usage.id,
        rule_id: rule.id,
        entries: entries.map((entry) => ({
          participant_id: entry.participant_id,
          amount_micro_usd: entry.amount_micro_usd,
        })),
      });
    }

    return true;
  }

  public async reconcile(input: ReconcileQueryInput): Promise<ReconcileResult> {
    let syncedUsageCount = 0;
    if (input.sync_pending !== false) {
      syncedUsageCount = await this.syncPendingUsage(input.tenant_id, input.sync_limit ?? 200);
    }

    const where = ["tenant_id = $1", "time_bucket >= $2", "time_bucket <= $3"];
    const params: Array<string> = [input.tenant_id, input.start, input.end];
    if (input.participant_id) {
      params.push(input.participant_id);
      where.push(`participant_id = $${params.length}`);
    }

    let rows: ReconcileResult["rows"] = [];
    try {
      const amountExpr =
        this.db.dialect === "postgresql"
          ? "coalesce(sum(amount_micro_usd), 0)::bigint"
          : "CAST(coalesce(sum(amount_micro_usd), 0) AS SIGNED)";
      const countExpr =
        this.db.dialect === "postgresql" ? "count(*)::int" : "CAST(count(*) AS SIGNED)";
      const summary = await this.db.query(
        `
          select participant_id,
                 max(participant_label) as participant_label,
                 ${amountExpr} as amount_micro_usd,
                 ${countExpr} as entry_count
          from billing_split_ledger
          where ${where.join(" and ")}
          group by participant_id
          order by amount_micro_usd desc
        `,
        params
      );
      rows = summary.rows.map((row) => ({
        participant_id: String(row.participant_id),
        participant_label: row.participant_label == null ? null : String(row.participant_label),
        amount_micro_usd: String(row.amount_micro_usd),
        entry_count: Number(row.entry_count ?? 0),
      }));
    } catch {
      rows = [];
    }

    const ledgerEntries = await this.listLedgerEntries(input.tenant_id, {
      start: input.start,
      end: input.end,
      participant_id: input.participant_id,
      limit: 1000,
    });

    return {
      rows,
      ledger_entries: ledgerEntries,
      synced_usage_count: syncedUsageCount,
    };
  }

  private resolveParticipants(rule: BillingSplitRule, usage: UsageRecordForSplit) {
    if (rule.split_mode === "by_billing_item") {
      const billingKey = usage.model ?? usage.provider ?? "default";
      const matched = rule.participants.filter((item) => !item.billing_item || item.billing_item === billingKey);
      return matched.length > 0 ? matched : rule.participants;
    }
    return rule.participants;
  }

  private mapLedger(row: Record<string, unknown>): BillingSplitLedgerEntry {
    return {
      id: String(row.id),
      tenant_id: String(row.tenant_id),
      usage_record_id: String(row.usage_record_id),
      rule_id: String(row.rule_id),
      rule_version: String(row.rule_version),
      participant_id: String(row.participant_id),
      participant_label: row.participant_label == null ? null : String(row.participant_label),
      amount_micro_usd: String(row.amount_micro_usd),
      original_cost_micro_usd: String(row.original_cost_micro_usd),
      time_bucket: row.time_bucket instanceof Date ? row.time_bucket.toISOString() : String(row.time_bucket),
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    };
  }
}

export { costUsdToMicro, microToUsdString };
