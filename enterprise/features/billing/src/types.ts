export type SplitMode = "fixed_ratio" | "by_billing_item";

export type SplitParticipant = {
  participant_id: string;
  label?: string;
  ratio_bps: number;
  billing_item?: string;
};

export type BillingSplitRule = {
  id: string;
  tenant_id: string;
  name: string;
  effective_start: string;
  effective_end: string | null;
  split_mode: SplitMode;
  participants: SplitParticipant[];
  billing_items: string[] | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type BillingSplitRuleInput = {
  tenant_id: string;
  name: string;
  effective_start: string;
  effective_end?: string | null;
  split_mode?: SplitMode;
  participants: SplitParticipant[];
  billing_items?: string[] | null;
  enabled?: boolean;
};

export type BillingSplitLedgerEntry = {
  id: string;
  tenant_id: string;
  usage_record_id: string;
  rule_id: string;
  rule_version: string;
  participant_id: string;
  participant_label: string | null;
  amount_micro_usd: string;
  original_cost_micro_usd: string;
  time_bucket: string;
  created_at: string;
};

export type UsageRecordForSplit = {
  id: string;
  tenant_id: string;
  cost_usd: number;
  time_bucket: string;
  provider?: string | null;
  model?: string | null;
};

export type ReconcileQueryInput = {
  tenant_id: string;
  start: string;
  end: string;
  participant_id?: string;
  sync_pending?: boolean;
  sync_limit?: number;
};

export type ReconcileParticipantRow = {
  participant_id: string;
  participant_label: string | null;
  amount_micro_usd: string;
  entry_count: number;
};

export type ReconcileResult = {
  rows: ReconcileParticipantRow[];
  ledger_entries: BillingSplitLedgerEntry[];
  synced_usage_count: number;
};

export type SettlementWebhookConfig = {
  tenant_id: string;
  webhook_url: string | null;
  enabled: boolean;
  updated_at: string;
};

export type SettlementWebhookEvent = {
  id: string;
  tenant_id: string;
  payload: Record<string, unknown>;
  status: string;
  response_status: number | null;
  created_at: string;
};

export type SettlementContractNotifyInput = {
  tenant_id: string;
  usage_record_id: string;
  rule_id: string;
  entries: Array<{
    participant_id: string;
    amount_micro_usd: string;
  }>;
};
