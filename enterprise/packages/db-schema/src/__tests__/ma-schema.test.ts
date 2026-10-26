import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig as getPgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as getMysqlTableConfig } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";

import { enterpriseAgents as pgAgents } from "../schema/agents";
import { enterpriseAgentVersions as pgVersions } from "../schema/agent-versions";
import { maEnvironments as pgEnvironments } from "../schema/ma-environments";
import { maCredentials as pgCredentials, maVaults as pgVaults } from "../schema/ma-vaults";
import {
  maMemories as pgMemories,
  maMemoryStores as pgMemoryStores,
  maMemoryVersions as pgMemoryVersions,
} from "../schema/ma-memory";
import { maScheduleRuns as pgScheduleRuns, maSchedules as pgSchedules } from "../schema/ma-schedules";
import { maWebhookDeliveries as pgDeliveries, maWebhooks as pgWebhooks } from "../schema/ma-webhooks";
import {
  maChannelConversations as pgChannelConversations,
  maChannelInbound as pgChannelInbound,
  maChannelRuntimeState as pgChannelRuntime,
  maChannels as pgChannels,
} from "../schema/ma-channels";
import { maAgentQuotas as pgQuotas } from "../schema/ma-agent-quotas";
import { maMemoryDreams as pgMemoryDreams } from "../schema/ma-memory-dreams";
import {
  maEvalCandidates as pgEvalCandidates,
  maEvalDatasetItems as pgEvalItems,
  maEvalDatasets as pgEvalDatasets,
  maEvalResults as pgEvalResults,
  maEvalRubrics as pgEvalRubrics,
  maEvalRuns as pgEvalRuns,
} from "../schema/ma-evals";
import {
  maSessionEvents as pgEvents,
  maSessionUsage as pgUsage,
  maSessions as pgSessions,
  maWorkItems as pgWorkItems,
} from "../schema/ma-sessions";
import { enterpriseAgents as mysqlAgents } from "../mysql-schema/agents";
import { enterpriseAgentVersions as mysqlVersions } from "../mysql-schema/agent-versions";
import { maEnvironments as mysqlEnvironments } from "../mysql-schema/ma-environments";
import { maCredentials as mysqlCredentials, maVaults as mysqlVaults } from "../mysql-schema/ma-vaults";
import {
  maMemories as mysqlMemories,
  maMemoryStores as mysqlMemoryStores,
  maMemoryVersions as mysqlMemoryVersions,
} from "../mysql-schema/ma-memory";
import { maScheduleRuns as mysqlScheduleRuns, maSchedules as mysqlSchedules } from "../mysql-schema/ma-schedules";
import { maWebhookDeliveries as mysqlDeliveries, maWebhooks as mysqlWebhooks } from "../mysql-schema/ma-webhooks";
import {
  maChannelConversations as mysqlChannelConversations,
  maChannelInbound as mysqlChannelInbound,
  maChannelRuntimeState as mysqlChannelRuntime,
  maChannels as mysqlChannels,
} from "../mysql-schema/ma-channels";
import { maAgentQuotas as mysqlQuotas } from "../mysql-schema/ma-agent-quotas";
import { maMemoryDreams as mysqlMemoryDreams } from "../mysql-schema/ma-memory-dreams";
import {
  maEvalCandidates as mysqlEvalCandidates,
  maEvalDatasetItems as mysqlEvalItems,
  maEvalDatasets as mysqlEvalDatasets,
  maEvalResults as mysqlEvalResults,
  maEvalRubrics as mysqlEvalRubrics,
  maEvalRuns as mysqlEvalRuns,
} from "../mysql-schema/ma-evals";
import {
  maSessionEvents as mysqlEvents,
  maSessionUsage as mysqlUsage,
  maSessions as mysqlSessions,
  maWorkItems as mysqlWorkItems,
} from "../mysql-schema/ma-sessions";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const MA_COLUMNS: Record<string, string[]> = {
  ma_environments: [
    "id",
    "tenant_id",
    "name",
    "description",
    "type",
    "config",
    "status",
    "created_by",
    "created_at",
    "updated_at",
  ],
  enterprise_agent_versions: [
    "id",
    "tenant_id",
    "agent_id",
    "version",
    "manifest",
    "manifest_hash",
    "note",
    "source",
    "created_by",
    "created_at",
  ],
  ma_sessions: [
    "id",
    "tenant_id",
    "agent_id",
    "agent_version",
    "environment_id",
    "created_by_user_id",
    "source",
    "status",
    "stop_reason",
    "title",
    "vault_ids",
    "resources",
    "usage_totals",
    "last_seq",
    "metadata",
    "archived_at",
    "created_at",
    "updated_at",
  ],
  ma_session_events: [
    "id",
    "tenant_id",
    "session_id",
    "seq",
    "thread_id",
    "type",
    "payload",
    "created_at",
    "processed_at",
  ],
  ma_work_items: [
    "id",
    "tenant_id",
    "session_id",
    "environment_id",
    "status",
    "claimed_by_user_id",
    "claimed_by_device",
    "claimed_at",
    "lease_expires_at",
    "last_heartbeat_at",
    "attempts",
    "completed_at",
    "error",
    "inbox_after_seq",
    "consumed_through_seq",
    "created_at",
    "updated_at",
  ],
  ma_vaults: [
    "id",
    "tenant_id",
    "display_name",
    "description",
    "metadata",
    "status",
    "created_by",
    "archived_at",
    "created_at",
    "updated_at",
  ],
  ma_credentials: [
    "id",
    "tenant_id",
    "vault_id",
    "display_name",
    "type",
    "identity_kind",
    "identity_key",
    "active_identity_key",
    "public_config",
    "secret_fields",
    "secret_ciphertext",
    "wrapped_dek",
    "kek_id",
    "status",
    "expires_at",
    "last_rotated_at",
    "last_resolved_at",
    "created_by",
    "archived_at",
    "created_at",
    "updated_at",
  ],
  ma_memory_stores: [
    "id",
    "tenant_id",
    "name",
    "description",
    "metadata",
    "status",
    "created_by",
    "archived_at",
    "created_at",
    "updated_at",
  ],
  ma_memories: [
    "id",
    "tenant_id",
    "store_id",
    "path",
    "path_hash",
    "content",
    "content_sha256",
    "size_bytes",
    "version",
    "last_actor_kind",
    "last_actor_user_id",
    "last_session_id",
    "created_at",
    "updated_at",
  ],
  ma_memory_versions: [
    "id",
    "tenant_id",
    "store_id",
    "memory_id",
    "version",
    "operation",
    "path",
    "path_hash",
    "content",
    "content_sha256",
    "size_bytes",
    "actor_kind",
    "actor_user_id",
    "source_session_id",
    "redacted",
    "redacted_at",
    "redacted_by",
    "created_at",
  ],
  ma_schedules: [
    "id",
    "tenant_id",
    "name",
    "description",
    "agent_id",
    "version_policy",
    "pinned_version",
    "environment_id",
    "cron",
    "timezone",
    "input_template",
    "vault_ids",
    "resources",
    "run_as_user_id",
    "enabled",
    "revision",
    "misfire_grace_seconds",
    "manual_run_requested_at",
    "created_by",
    "created_at",
    "updated_at",
  ],
  ma_schedule_runs: [
    "id",
    "tenant_id",
    "schedule_id",
    "schedule_revision",
    "trigger",
    "scheduled_for",
    "status",
    "skip_reason",
    "session_id",
    "agent_version",
    "error",
    "started_at",
    "finished_at",
    "created_at",
    "updated_at",
  ],
  ma_channels: [
    "id",
    "tenant_id",
    "name",
    "platform",
    "agent_id",
    "routing",
    "pinned_version",
    "environment_id",
    "app_id",
    "credential_vault_id",
    "credential_id",
    "owner_user_id",
    "config",
    "enabled",
    "revision",
    "created_by",
    "created_at",
    "updated_at",
  ],
  ma_channel_conversations: [
    "id",
    "tenant_id",
    "channel_id",
    "conversation_key",
    "conversation_type",
    "session_id",
    "agent_version",
    "last_message_at",
    "created_at",
    "updated_at",
  ],
  ma_channel_inbound: ["channel_id", "platform_message_id", "tenant_id", "received_at"],
  ma_channel_runtime_state: [
    "channel_id",
    "tenant_id",
    "revision",
    "status",
    "last_error",
    "last_event_at",
    "started_at",
    "updated_at",
  ],
  ma_webhooks: [
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
    "failure_reset_at",
    "secret_ciphertext",
    "wrapped_dek",
    "kek_id",
    "secret_rotated_at",
    "created_by",
    "created_at",
    "updated_at",
  ],
  ma_webhook_deliveries: [
    "id",
    "tenant_id",
    "webhook_id",
    "event_id",
    "event_type",
    "event_key",
    "payload",
    "status",
    "attempts",
    "next_attempt_at",
    "locked_until",
    "last_status_code",
    "last_error",
    "delivered_at",
    "created_at",
    "updated_at",
  ],
  ma_session_usage: [
    "id",
    "tenant_id",
    "session_id",
    "agent_id",
    "agent_version",
    "user_id",
    "model",
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "tool_calls",
    "runtime_ms",
    "is_error",
    "event_seq",
    "created_at",
  ],
  ma_agent_quotas: [
    "id",
    "tenant_id",
    "agent_id",
    "subject_key",
    "user_id",
    "daily_tokens",
    "weekly_tokens",
    "monthly_tokens",
    "created_by",
    "created_at",
    "updated_at",
  ],
  ma_eval_datasets: [
    "id",
    "tenant_id",
    "name",
    "description",
    "item_count",
    "created_by",
    "created_at",
    "updated_at",
  ],
  ma_eval_dataset_items: [
    "id",
    "tenant_id",
    "dataset_id",
    "position",
    "query",
    "expected_answer",
    "expected_tool_trace",
    "tags",
    "source_session_id",
    "created_at",
    "updated_at",
  ],
  ma_eval_rubrics: [
    "id",
    "tenant_id",
    "name",
    "description",
    "version",
    "content",
    "content_hash",
    "created_by",
    "created_at",
    "updated_at",
  ],
  ma_eval_runs: [
    "id",
    "tenant_id",
    "kind",
    "status",
    "agent_id",
    "agent_version",
    "environment_id",
    "dataset_id",
    "dataset_name",
    "dataset_hash",
    "rubric_id",
    "rubric_name",
    "rubric_version",
    "rubric_hash",
    "base_run_id",
    "config",
    "progress",
    "summary",
    "error",
    "created_by",
    "claimed_by",
    "heartbeat_at",
    "started_at",
    "finished_at",
    "created_at",
    "updated_at",
  ],
  ma_eval_results: [
    "id",
    "tenant_id",
    "run_id",
    "item_id",
    "position",
    "status",
    "score_milli",
    "session_id",
    "answer",
    "tool_names",
    "stop_reason",
    "rule_results",
    "judge",
    "usage",
    "duration_ms",
    "error",
    "created_at",
  ],
  ma_eval_candidates: [
    "id",
    "tenant_id",
    "run_id",
    "base_run_id",
    "agent_id",
    "base_version",
    "manifest",
    "manifest_hash",
    "diff",
    "rationale",
    "status",
    "applied_version",
    "decided_by",
    "decided_at",
    "created_at",
    "updated_at",
  ],
  ma_memory_dreams: [
    "id",
    "tenant_id",
    "status",
    "input_memory_store_id",
    "output_memory_store_id",
    "session_ids",
    "instructions",
    "model",
    "report",
    "error",
    "cancel_requested",
    "created_by",
    "claimed_by",
    "heartbeat_at",
    "started_at",
    "finished_at",
    "created_at",
    "updated_at",
  ],
};

function columnNames(table: Parameters<typeof getTableColumns>[0]): string[] {
  return Object.values(getTableColumns(table))
    .map((column) => column.name)
    .sort();
}

function columnName(column: unknown): string {
  if (column && typeof column === "object" && "name" in column && typeof column.name === "string") {
    return column.name;
  }
  return "";
}

function expectUniqueIndex(
  indexes: ReadonlyArray<{ config: { name?: string; unique?: boolean; columns: ReadonlyArray<unknown> } }>,
  name: string,
  columns: string[],
): void {
  const match = indexes.find((index) => index.config.name === name);
  expect(match, name).toBeTruthy();
  expect(match?.config.unique).toBe(true);
  expect(match?.config.columns.map(columnName)).toEqual(columns);
}

describe("managed agent schema", () => {
  it("defines MA tables with the frozen column sets", () => {
    const tables = [
      [pgEnvironments, mysqlEnvironments],
      [pgVersions, mysqlVersions],
      [pgSessions, mysqlSessions],
      [pgEvents, mysqlEvents],
      [pgWorkItems, mysqlWorkItems],
      [pgUsage, mysqlUsage],
      [pgVaults, mysqlVaults],
      [pgCredentials, mysqlCredentials],
      [pgMemoryStores, mysqlMemoryStores],
      [pgMemories, mysqlMemories],
      [pgMemoryVersions, mysqlMemoryVersions],
      [pgSchedules, mysqlSchedules],
      [pgScheduleRuns, mysqlScheduleRuns],
      [pgWebhooks, mysqlWebhooks],
      [pgDeliveries, mysqlDeliveries],
      [pgChannels, mysqlChannels],
      [pgChannelConversations, mysqlChannelConversations],
      [pgChannelInbound, mysqlChannelInbound],
      [pgChannelRuntime, mysqlChannelRuntime],
      [pgQuotas, mysqlQuotas],
      [pgEvalDatasets, mysqlEvalDatasets],
      [pgEvalItems, mysqlEvalItems],
      [pgEvalRubrics, mysqlEvalRubrics],
      [pgEvalRuns, mysqlEvalRuns],
      [pgEvalResults, mysqlEvalResults],
      [pgEvalCandidates, mysqlEvalCandidates],
      [pgMemoryDreams, mysqlMemoryDreams],
    ] as const;
    for (const [pg, mysql] of tables) {
      const name = getTableName(pg);
      expect(getTableName(mysql)).toBe(name);
      const expected = [...(MA_COLUMNS[name] ?? [])].sort();
      expect(expected, name).not.toEqual([]);
      expect(columnNames(pg)).toEqual(expected);
      expect(columnNames(mysql)).toEqual(expected);
    }
    expect(tables).toHaveLength(27);
  });

  it("keeps active_identity_key nullable in both dialects", () => {
    for (const table of [pgCredentials, mysqlCredentials]) {
      const columns = getTableColumns(table);
      expect(columns.activeIdentityKey?.name).toBe("active_identity_key");
      expect(columns.activeIdentityKey?.notNull).toBe(false);
    }
    expectUniqueIndex(
      getPgTableConfig(pgCredentials).indexes,
      "ma_credentials_vault_active_identity_uq",
      ["vault_id", "active_identity_key"],
    );
    expectUniqueIndex(
      getMysqlTableConfig(mysqlCredentials).indexes,
      "ma_credentials_vault_active_identity_uq",
      ["vault_id", "active_identity_key"],
    );
  });

  it("adds version routing columns to enterprise_agents", () => {
    for (const agents of [pgAgents, mysqlAgents]) {
      const columns = getTableColumns(agents);
      expect(columns.latestVersion?.notNull).toBe(true);
      expect(columns.pinnedVersion?.notNull).toBe(false);
      expect(columns.versionRouting?.notNull).toBe(true);
      expect(columns.defaultEnvironmentId?.notNull).toBe(false);
      expect(columns.latestVersion?.name).toBe("latest_version");
      expect(columns.pinnedVersion?.name).toBe("pinned_version");
      expect(columns.versionRouting?.name).toBe("version_routing");
      expect(columns.defaultEnvironmentId?.name).toBe("default_environment_id");
    }
  });

  it("declares unique (session_id, seq) on ma_session_events", () => {
    expectUniqueIndex(getPgTableConfig(pgEvents).indexes, "ma_session_events_session_seq_uq", ["session_id", "seq"]);
    expectUniqueIndex(getMysqlTableConfig(mysqlEvents).indexes, "ma_session_events_session_seq_uq", ["session_id", "seq"]);
    expectUniqueIndex(
      getPgTableConfig(pgVersions).indexes,
      "enterprise_agent_versions_agent_version_uq",
      ["agent_id", "version"],
    );
    expectUniqueIndex(
      getMysqlTableConfig(mysqlVersions).indexes,
      "enterprise_agent_versions_agent_version_uq",
      ["agent_id", "version"],
    );
  });

  it("stores memory content as mediumtext on MySQL", () => {
    for (const table of [mysqlMemories, mysqlMemoryVersions]) {
      const column = getTableColumns(table).content as { columnType?: string; textType?: string } | undefined;
      expect(column?.columnType).toBe("MySqlText");
      expect(column?.textType).toBe("mediumtext");
    }
  });

  it("stores eval case text as mediumtext on MySQL and shares column sets", () => {
    const itemColumns = getTableColumns(mysqlEvalItems);
    const resultColumns = getTableColumns(mysqlEvalResults);
    for (const column of [itemColumns.query, itemColumns.expectedAnswer, resultColumns.answer]) {
      const textColumn = column as { columnType?: string; textType?: string };
      expect(textColumn.columnType).toBe("MySqlText");
      expect(textColumn.textType).toBe("mediumtext");
    }
    expectUniqueIndex(getPgTableConfig(pgEvalDatasets).indexes, "ma_eval_datasets_tenant_name_uq", [
      "tenant_id",
      "name",
    ]);
    expectUniqueIndex(getMysqlTableConfig(mysqlEvalDatasets).indexes, "ma_eval_datasets_tenant_name_uq", [
      "tenant_id",
      "name",
    ]);
    expectUniqueIndex(getPgTableConfig(pgEvalItems).indexes, "ma_eval_dataset_items_dataset_position_uq", [
      "dataset_id",
      "position",
    ]);
    expectUniqueIndex(getMysqlTableConfig(mysqlEvalItems).indexes, "ma_eval_dataset_items_dataset_position_uq", [
      "dataset_id",
      "position",
    ]);
    expectUniqueIndex(getPgTableConfig(pgEvalResults).indexes, "ma_eval_results_run_item_uq", ["run_id", "item_id"]);
    expectUniqueIndex(getMysqlTableConfig(mysqlEvalResults).indexes, "ma_eval_results_run_item_uq", ["run_id", "item_id"]);
  });

  it("declares memory path and version unique indexes", () => {
    expectUniqueIndex(getPgTableConfig(pgMemories).indexes, "ma_memories_store_path_uq", ["store_id", "path_hash"]);
    expectUniqueIndex(getMysqlTableConfig(mysqlMemories).indexes, "ma_memories_store_path_uq", ["store_id", "path_hash"]);
    expectUniqueIndex(
      getPgTableConfig(pgMemoryVersions).indexes,
      "ma_memory_versions_memory_version_uq",
      ["memory_id", "version"],
    );
    expectUniqueIndex(
      getMysqlTableConfig(mysqlMemoryVersions).indexes,
      "ma_memory_versions_memory_version_uq",
      ["memory_id", "version"],
    );
  });

  it("declares schedule and webhook unique indexes", () => {
    expectUniqueIndex(getPgTableConfig(pgSchedules).indexes, "ma_schedules_tenant_name_uq", ["tenant_id", "name"]);
    expectUniqueIndex(getMysqlTableConfig(mysqlSchedules).indexes, "ma_schedules_tenant_name_uq", ["tenant_id", "name"]);
    expectUniqueIndex(getPgTableConfig(pgScheduleRuns).indexes, "ma_schedule_runs_slot_uq", [
      "schedule_id",
      "trigger",
      "scheduled_for",
    ]);
    expectUniqueIndex(getMysqlTableConfig(mysqlScheduleRuns).indexes, "ma_schedule_runs_slot_uq", [
      "schedule_id",
      "trigger",
      "scheduled_for",
    ]);
    expectUniqueIndex(getPgTableConfig(pgWebhooks).indexes, "ma_webhooks_tenant_name_uq", ["tenant_id", "name"]);
    expectUniqueIndex(getMysqlTableConfig(mysqlWebhooks).indexes, "ma_webhooks_tenant_name_uq", ["tenant_id", "name"]);
    expectUniqueIndex(getPgTableConfig(pgDeliveries).indexes, "ma_webhook_deliveries_event_uq", ["webhook_id", "event_key"]);
    expectUniqueIndex(getMysqlTableConfig(mysqlDeliveries).indexes, "ma_webhook_deliveries_event_uq", [
      "webhook_id",
      "event_key",
    ]);
    expectUniqueIndex(getPgTableConfig(pgChannels).indexes, "ma_channels_tenant_name_uq", ["tenant_id", "name"]);
    expectUniqueIndex(getMysqlTableConfig(mysqlChannels).indexes, "ma_channels_tenant_name_uq", ["tenant_id", "name"]);
    expectUniqueIndex(getPgTableConfig(pgChannels).indexes, "ma_channels_tenant_app_uq", [
      "tenant_id",
      "platform",
      "app_id",
    ]);
    expectUniqueIndex(getMysqlTableConfig(mysqlChannels).indexes, "ma_channels_tenant_app_uq", [
      "tenant_id",
      "platform",
      "app_id",
    ]);
    expectUniqueIndex(getPgTableConfig(pgChannelConversations).indexes, "ma_channel_conversations_key_uq", [
      "channel_id",
      "conversation_key",
    ]);
    expectUniqueIndex(getMysqlTableConfig(mysqlChannelConversations).indexes, "ma_channel_conversations_key_uq", [
      "channel_id",
      "conversation_key",
    ]);
  });

  it("declares the quota subject unique index and the usage lookup index", () => {
    expectUniqueIndex(getPgTableConfig(pgQuotas).indexes, "ma_agent_quotas_subject_uq", [
      "tenant_id",
      "agent_id",
      "subject_key",
    ]);
    expectUniqueIndex(getMysqlTableConfig(mysqlQuotas).indexes, "ma_agent_quotas_subject_uq", [
      "tenant_id",
      "agent_id",
      "subject_key",
    ]);
    const pgUsageIndexes = getPgTableConfig(pgUsage).indexes.map((index) => index.config.name);
    const mysqlUsageIndexes = getMysqlTableConfig(mysqlUsage).indexes.map((index) => index.config.name);
    expect(pgUsageIndexes).toContain("ma_session_usage_quota_idx");
    expect(mysqlUsageIndexes).toContain("ma_session_usage_quota_idx");
    const pgSql = readFileSync(join(packageRoot, "drizzle/0067_ma_agent_quotas.sql"), "utf8");
    const mysqlSql = readFileSync(join(packageRoot, "drizzle-mysql/0041_ma_agent_quotas.sql"), "utf8");
    expect(pgSql).toContain("ma_session_usage_quota_idx");
    expect(mysqlSql).toContain("ma_session_usage_quota_idx");
    expect(pgSql).toContain("ma_agent_quotas");
    expect(mysqlSql).toContain("ma_agent_quotas");
  });

  it("keeps 0061 and 0035 migrations in sync on table names", () => {
    const pg = readFileSync(join(packageRoot, "drizzle/0061_ma_control_plane.sql"), "utf8");
    const mysql = readFileSync(join(packageRoot, "drizzle-mysql/0035_ma_control_plane.sql"), "utf8");
    const extract = (sql: string) =>
      [...sql.matchAll(/CREATE TABLE IF NOT EXISTS ["`](\w+)["`]/g)].map((match) => match[1]!).sort();
    const pgTables = extract(pg);
    const mysqlTables = extract(mysql);
    expect(pgTables).toEqual(mysqlTables);
    expect(pgTables).toEqual([
      "enterprise_agent_versions",
      "ma_environments",
      "ma_session_events",
      "ma_session_usage",
      "ma_sessions",
      "ma_work_items",
    ]);
  });
});
