import type { MaSchedule, MaScheduleRun } from "@agenticx/iam-core";

const SCHEDULE_KEYS = [
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
  "next_run_at",
  "last_run",
  "created_at",
  "updated_at",
] as const;

const RUN_KEYS = [
  "id",
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
] as const;

export type ScheduleSummary = { nextRunAt: string | null; lastRun: MaScheduleRun | null };

export function toMaScheduleRunRecord(run: MaScheduleRun): Record<(typeof RUN_KEYS)[number], unknown> {
  return {
    id: run.id,
    schedule_id: run.scheduleId,
    schedule_revision: run.scheduleRevision,
    trigger: run.trigger,
    scheduled_for: run.scheduledFor,
    status: run.status,
    skip_reason: run.skipReason,
    session_id: run.sessionId,
    agent_version: run.agentVersion,
    error: run.error,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    created_at: run.createdAt,
  };
}

export function toMaScheduleRecord(
  schedule: MaSchedule,
  summary: ScheduleSummary,
): Record<(typeof SCHEDULE_KEYS)[number], unknown> {
  return {
    id: schedule.id,
    tenant_id: schedule.tenantId,
    name: schedule.name,
    description: schedule.description,
    agent_id: schedule.agentId,
    version_policy: schedule.versionPolicy,
    pinned_version: schedule.pinnedVersion,
    environment_id: schedule.environmentId,
    cron: schedule.cron,
    timezone: schedule.timezone,
    input_template: schedule.inputTemplate,
    vault_ids: schedule.vaultIds,
    resources: schedule.resources,
    run_as_user_id: schedule.runAsUserId,
    enabled: schedule.enabled,
    revision: schedule.revision,
    misfire_grace_seconds: schedule.misfireGraceSeconds,
    next_run_at: summary.nextRunAt,
    last_run: summary.lastRun
      ? {
          id: summary.lastRun.id,
          status: summary.lastRun.status,
          scheduled_for: summary.lastRun.scheduledFor,
          session_id: summary.lastRun.sessionId,
        }
      : null,
    created_at: schedule.createdAt,
    updated_at: schedule.updatedAt,
  };
}

/** Internal runtime snapshot: schedule fields plus manual_run_requested_at, without computed run columns. */
export function toMaScheduleRuntimeRecord(schedule: MaSchedule): Record<string, unknown> {
  return {
    id: schedule.id,
    tenant_id: schedule.tenantId,
    name: schedule.name,
    description: schedule.description,
    agent_id: schedule.agentId,
    version_policy: schedule.versionPolicy,
    pinned_version: schedule.pinnedVersion,
    environment_id: schedule.environmentId,
    cron: schedule.cron,
    timezone: schedule.timezone,
    input_template: schedule.inputTemplate,
    vault_ids: schedule.vaultIds,
    resources: schedule.resources,
    run_as_user_id: schedule.runAsUserId,
    enabled: schedule.enabled,
    revision: schedule.revision,
    misfire_grace_seconds: schedule.misfireGraceSeconds,
    manual_run_requested_at: schedule.manualRunRequestedAt,
    created_at: schedule.createdAt,
    updated_at: schedule.updatedAt,
  };
}

export const MA_SCHEDULE_RECORD_KEYS = SCHEDULE_KEYS;
export const MA_SCHEDULE_RUN_RECORD_KEYS = RUN_KEYS;
