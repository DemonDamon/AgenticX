import { deleteMaSchedule, getMaSchedule, getMaScheduleRunSummary, updateMaSchedule } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import { toMaScheduleRecord, type ScheduleSummary } from "../../../../../lib/ma/schedule-records";
import { emitMaResourceEvent } from "../../../../../lib/ma/webhook-events";
import { assertAdminKeys, automationErrorResponse, ok, readAdminJson, requiredTenantId } from "../shared";

export const dynamic = "force-dynamic";

const KEYS = [
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
  "enabled",
  "misfire_grace_seconds",
] as const;

const EMPTY_SUMMARY: ScheduleSummary = { nextRunAt: null, lastRun: null };

function notFound(): Response {
  return automationErrorResponse(Object.assign(new Error("定时任务不存在"), { name: "MaScheduleNotFoundError" }));
}

async function present(tenantId: string, scheduleId: string) {
  const schedule = await getMaSchedule(tenantId, scheduleId);
  const summary = await getMaScheduleRunSummary(tenantId, [schedule.id]);
  return toMaScheduleRecord(schedule, summary.get(schedule.id) ?? EMPTY_SUMMARY);
}

export async function GET(_request: Request, context: { params: Promise<{ scheduleId: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { scheduleId } = await context.params;
    return ok({ schedule: await present(requiredTenantId(), scheduleId) });
  } catch (error) {
    return automationErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ scheduleId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { scheduleId } = await context.params;
    if (!scheduleId) return notFound();
    const body = await readAdminJson(request);
    assertAdminKeys(body, KEYS);
    const tenantId = requiredTenantId();
    const schedule = await updateMaSchedule(tenantId, scheduleId, body);
    emitMaResourceEvent({
      tenantId,
      type: "schedule.updated",
      resourceId: schedule.id,
      extra: { agent_id: schedule.agentId },
    });
    return ok({ schedule: await present(tenantId, scheduleId) });
  } catch (error) {
    return automationErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ scheduleId: string }> }) {
  const auth = await requireAdminScope(["provider:delete"]);
  if (!auth.ok) return auth.response;
  try {
    const { scheduleId } = await context.params;
    const removed = await deleteMaSchedule(requiredTenantId(), scheduleId);
    emitMaResourceEvent({
      tenantId: requiredTenantId(),
      type: "schedule.deleted",
      resourceId: removed.id,
      extra: { agent_id: removed.agentId },
    });
    return ok({ deleted: true });
  } catch (error) {
    return automationErrorResponse(error);
  }
}
