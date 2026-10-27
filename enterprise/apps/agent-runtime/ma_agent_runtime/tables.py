#!/usr/bin/env python3
"""SQLAlchemy Core tables mirroring the managed-agent session DDL.

Production tables are created by drizzle migrations. ``create_all`` is for tests.

Author: Damon Li
"""

from __future__ import annotations

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Index,
    Integer,
    MetaData,
    PrimaryKeyConstraint,
    String,
    Table,
    Text,
    UniqueConstraint,
    false,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB

metadata = MetaData()
JSONType = JSON().with_variant(JSONB(), "postgresql")
TS = DateTime(timezone=True)

ma_sessions = Table(
    "ma_sessions",
    metadata,
    Column("id", String(26), primary_key=True, nullable=False),
    Column("tenant_id", String(26), nullable=False),
    Column("agent_id", String(26), nullable=False),
    Column("agent_version", Integer, nullable=False),
    Column("environment_id", String(26)),
    Column("created_by_user_id", String(26)),
    Column("source", String(16), nullable=False),
    Column("status", String(16), nullable=False, server_default=text("'idle'")),
    Column("stop_reason", JSONType),
    Column("title", String(255)),
    Column("vault_ids", JSONType, nullable=False, server_default=text("'[]'")),
    Column("resources", JSONType, nullable=False, server_default=text("'[]'")),
    Column("usage_totals", JSONType, nullable=False, server_default=text("'{}'")),
    Column("last_seq", BigInteger, nullable=False, server_default=text("0")),
    Column("metadata", JSONType, nullable=False, server_default=text("'{}'")),
    Column("archived_at", TS),
    Column("created_at", TS, nullable=False),
    Column("updated_at", TS, nullable=False),
)

ma_session_events = Table(
    "ma_session_events",
    metadata,
    Column("id", String(26), primary_key=True, nullable=False),
    Column("tenant_id", String(26), nullable=False),
    Column("session_id", String(26), nullable=False),
    Column("seq", BigInteger, nullable=False),
    Column("thread_id", String(26)),
    Column("type", String(64), nullable=False),
    Column("payload", JSONType, nullable=False),
    Column("created_at", TS, nullable=False),
    Column("processed_at", TS),
    UniqueConstraint("session_id", "seq", name="ma_session_events_session_seq_uq"),
)

ma_work_items = Table(
    "ma_work_items",
    metadata,
    Column("id", String(26), primary_key=True, nullable=False),
    Column("tenant_id", String(26), nullable=False),
    Column("session_id", String(26), nullable=False),
    Column("environment_id", String(26), nullable=False),
    Column("status", String(16), nullable=False, server_default=text("'queued'")),
    Column("claimed_by_user_id", String(26)),
    Column("claimed_by_device", String(64)),
    Column("claimed_at", TS),
    Column("lease_expires_at", TS),
    Column("last_heartbeat_at", TS),
    Column("attempts", Integer, nullable=False, server_default=text("0")),
    Column("completed_at", TS),
    Column("error", Text),
    Column("created_at", TS, nullable=False),
    Column("updated_at", TS, nullable=False),
    Column("inbox_after_seq", BigInteger, nullable=False, server_default=text("0")),
    Column("consumed_through_seq", BigInteger),
)

ma_session_usage = Table(
    "ma_session_usage",
    metadata,
    Column("id", String(26), primary_key=True, nullable=False),
    Column("tenant_id", String(26), nullable=False),
    Column("session_id", String(26), nullable=False),
    Column("agent_id", String(26), nullable=False),
    Column("agent_version", Integer, nullable=False),
    Column("user_id", String(26)),
    Column("model", String(160), nullable=False),
    Column("input_tokens", BigInteger, nullable=False, server_default=text("0")),
    Column("output_tokens", BigInteger, nullable=False, server_default=text("0")),
    Column("cache_read_input_tokens", BigInteger, nullable=False, server_default=text("0")),
    Column("tool_calls", Integer, nullable=False, server_default=text("0")),
    Column("runtime_ms", BigInteger, nullable=False, server_default=text("0")),
    Column("is_error", Boolean, nullable=False, server_default=false()),
    Column("event_seq", BigInteger),
    Column("created_at", TS, nullable=False),
    UniqueConstraint("session_id", "event_seq", name="ma_session_usage_session_event_uq"),
)

ma_schedule_runs = Table(
    "ma_schedule_runs",
    metadata,
    Column("id", String(26), primary_key=True, nullable=False),
    Column("tenant_id", String(26), nullable=False),
    Column("schedule_id", String(26), nullable=False),
    Column("schedule_revision", Integer, nullable=False),
    Column("trigger", String(16), nullable=False),
    Column("scheduled_for", TS, nullable=False),
    Column("status", String(16), nullable=False, server_default=text("'scheduled'")),
    Column("skip_reason", String(32)),
    Column("session_id", String(26)),
    Column("agent_version", Integer),
    Column("error", String(500)),
    Column("started_at", TS),
    Column("finished_at", TS),
    Column("created_at", TS, nullable=False),
    Column("updated_at", TS, nullable=False),
    UniqueConstraint("schedule_id", "trigger", "scheduled_for", name="ma_schedule_runs_slot_uq"),
    Index("ma_schedule_runs_due_idx", "status", "scheduled_for"),
    Index("ma_schedule_runs_schedule_idx", "tenant_id", "schedule_id", "scheduled_for"),
    Index("ma_schedule_runs_session_idx", "session_id"),
)

ma_webhook_deliveries = Table(
    "ma_webhook_deliveries",
    metadata,
    Column("id", String(26), primary_key=True, nullable=False),
    Column("tenant_id", String(26), nullable=False),
    Column("webhook_id", String(26), nullable=False),
    Column("event_id", String(26), nullable=False),
    Column("event_type", String(32), nullable=False),
    Column("event_key", String(160), nullable=False),
    Column("payload", JSONType, nullable=False),
    Column("status", String(16), nullable=False, server_default=text("'pending'")),
    Column("attempts", Integer, nullable=False, server_default=text("0")),
    Column("next_attempt_at", TS, nullable=False),
    Column("locked_until", TS),
    Column("last_status_code", Integer),
    Column("last_error", String(500)),
    Column("delivered_at", TS),
    Column("created_at", TS, nullable=False),
    Column("updated_at", TS, nullable=False),
    UniqueConstraint("webhook_id", "event_key", name="ma_webhook_deliveries_event_uq"),
    Index("ma_webhook_deliveries_due_idx", "status", "next_attempt_at"),
    Index("ma_webhook_deliveries_webhook_idx", "tenant_id", "webhook_id", "created_at"),
)

ma_channel_conversations = Table(
    "ma_channel_conversations",
    metadata,
    Column("id", String(26), primary_key=True, nullable=False),
    Column("tenant_id", String(26), nullable=False),
    Column("channel_id", String(26), nullable=False),
    Column("conversation_key", String(160), nullable=False),
    Column("conversation_type", String(16), nullable=False),
    Column("session_id", String(26), nullable=False),
    Column("agent_version", Integer, nullable=False),
    Column("last_message_at", TS, nullable=False),
    Column("created_at", TS, nullable=False),
    Column("updated_at", TS, nullable=False),
    UniqueConstraint("channel_id", "conversation_key", name="ma_channel_conversations_key_uq"),
    Index("ma_channel_conversations_session_idx", "session_id"),
)

ma_channel_inbound = Table(
    "ma_channel_inbound",
    metadata,
    Column("channel_id", String(26), nullable=False),
    Column("platform_message_id", String(128), nullable=False),
    Column("tenant_id", String(26), nullable=False),
    Column("received_at", TS, nullable=False),
    PrimaryKeyConstraint("channel_id", "platform_message_id", name="ma_channel_inbound_pk"),
    Index("ma_channel_inbound_received_idx", "received_at"),
)

ma_channel_runtime_state = Table(
    "ma_channel_runtime_state",
    metadata,
    Column("channel_id", String(26), primary_key=True, nullable=False),
    Column("tenant_id", String(26), nullable=False),
    Column("revision", Integer, nullable=False),
    Column("status", String(16), nullable=False),
    Column("last_error", String(500)),
    Column("last_event_at", TS),
    Column("started_at", TS),
    Column("updated_at", TS, nullable=False),
)

# MA-E12 eval tables. MA-A10 may append sibling tables in this module.
ma_eval_runs = Table(
    "ma_eval_runs",
    metadata,
    Column("id", String(26), primary_key=True, nullable=False),
    Column("tenant_id", String(26), nullable=False),
    Column("kind", String(16), nullable=False),
    Column("status", String(16), nullable=False, server_default=text("'queued'")),
    Column("agent_id", String(26), nullable=False),
    Column("agent_version", Integer, nullable=False),
    Column("environment_id", String(26)),
    Column("dataset_id", String(26)),
    Column("dataset_name", String(128), nullable=False),
    Column("dataset_hash", String(80), nullable=False),
    Column("rubric_id", String(26)),
    Column("rubric_name", String(128), nullable=False),
    Column("rubric_version", Integer, nullable=False),
    Column("rubric_hash", String(80), nullable=False),
    Column("base_run_id", String(26)),
    Column("config", JSONType, nullable=False),
    Column("progress", JSONType, nullable=False, server_default=text("'{}'")),
    Column("summary", JSONType, nullable=False, server_default=text("'{}'")),
    Column("error", Text),
    Column("created_by", String(26)),
    Column("claimed_by", String(64)),
    Column("heartbeat_at", TS),
    Column("started_at", TS),
    Column("finished_at", TS),
    Column("created_at", TS, nullable=False),
    Column("updated_at", TS, nullable=False),
    Index("ma_eval_runs_tenant_created_idx", "tenant_id", "created_at"),
    Index("ma_eval_runs_status_created_idx", "status", "created_at"),
    Index("ma_eval_runs_tenant_agent_idx", "tenant_id", "agent_id", "created_at"),
)

ma_eval_results = Table(
    "ma_eval_results",
    metadata,
    Column("id", String(26), primary_key=True, nullable=False),
    Column("tenant_id", String(26), nullable=False),
    Column("run_id", String(26), nullable=False),
    Column("item_id", String(26), nullable=False),
    Column("position", Integer, nullable=False),
    Column("status", String(16), nullable=False),
    Column("score_milli", Integer),
    Column("session_id", String(26)),
    Column("answer", Text),
    Column("tool_names", JSONType, nullable=False, server_default=text("'[]'")),
    Column("stop_reason", String(32)),
    Column("rule_results", JSONType, nullable=False, server_default=text("'[]'")),
    Column("judge", JSONType),
    Column("usage", JSONType, nullable=False, server_default=text("'{}'")),
    Column("duration_ms", Integer, nullable=False, server_default=text("0")),
    Column("error", Text),
    Column("created_at", TS, nullable=False),
    UniqueConstraint("run_id", "item_id", name="ma_eval_results_run_item_uq"),
    Index("ma_eval_results_run_position_idx", "run_id", "position"),
)

ma_eval_candidates = Table(
    "ma_eval_candidates",
    metadata,
    Column("id", String(26), primary_key=True, nullable=False),
    Column("tenant_id", String(26), nullable=False),
    Column("run_id", String(26), nullable=False),
    Column("base_run_id", String(26), nullable=False),
    Column("agent_id", String(26), nullable=False),
    Column("base_version", Integer, nullable=False),
    Column("manifest", JSONType, nullable=False),
    Column("manifest_hash", String(80), nullable=False),
    Column("diff", JSONType, nullable=False, server_default=text("'{}'")),
    Column("rationale", Text),
    Column("status", String(16), nullable=False, server_default=text("'proposed'")),
    Column("applied_version", Integer),
    Column("decided_by", String(26)),
    Column("decided_at", TS),
    Column("created_at", TS, nullable=False),
    Column("updated_at", TS, nullable=False),
    Index("ma_eval_candidates_tenant_agent_idx", "tenant_id", "agent_id", "created_at"),
)

MANAGED_TABLES = (ma_sessions, ma_session_events, ma_work_items, ma_session_usage)
AUTOMATION_TABLES = (ma_schedule_runs, ma_webhook_deliveries)
CHANNEL_TABLES = (ma_channel_conversations, ma_channel_inbound, ma_channel_runtime_state)
EVAL_TABLES = (ma_eval_runs, ma_eval_results, ma_eval_candidates)

# MA-A10 memory dream jobs. agent-runtime is the only writer.
ma_memory_dreams = Table(
    "ma_memory_dreams",
    metadata,
    Column("id", String(26), primary_key=True, nullable=False),
    Column("tenant_id", String(26), nullable=False),
    Column("status", String(16), nullable=False, server_default=text("'pending'")),
    Column("input_memory_store_id", String(26), nullable=False),
    Column("output_memory_store_id", String(26), nullable=False),
    Column("session_ids", JSONType, nullable=False),
    Column("instructions", Text, nullable=False),
    Column("model", String(160), nullable=False),
    Column("report", JSONType, nullable=False, server_default=text("'{}'")),
    Column("error", JSONType),
    Column("cancel_requested", Boolean, nullable=False, server_default=false()),
    Column("created_by", String(26)),
    Column("claimed_by", String(64)),
    Column("heartbeat_at", TS),
    Column("started_at", TS),
    Column("finished_at", TS),
    Column("created_at", TS, nullable=False),
    Column("updated_at", TS, nullable=False),
    Index("ma_memory_dreams_tenant_created_idx", "tenant_id", "created_at"),
    Index("ma_memory_dreams_status_created_idx", "status", "created_at"),
    Index("ma_memory_dreams_tenant_input_idx", "tenant_id", "input_memory_store_id", "created_at"),
)

DREAM_TABLES = (ma_memory_dreams,)

__all__ = [
    "AUTOMATION_TABLES",
    "CHANNEL_TABLES",
    "DREAM_TABLES",
    "EVAL_TABLES",
    "JSONType",
    "MANAGED_TABLES",
    "TS",
    "ma_memory_dreams",
    "ma_channel_conversations",
    "ma_channel_inbound",
    "ma_channel_runtime_state",
    "ma_eval_candidates",
    "ma_eval_results",
    "ma_eval_runs",
    "ma_schedule_runs",
    "ma_session_events",
    "ma_session_usage",
    "ma_sessions",
    "ma_webhook_deliveries",
    "ma_work_items",
    "metadata",
]
