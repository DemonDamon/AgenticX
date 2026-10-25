import { createMaSchedule, getMaScheduleRunSummary, listMaSchedules } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../lib/admin-auth";
import { toMaScheduleRecord, type ScheduleSummary } from "../../../../lib/ma/schedule-records";
import { assertAdminKeys, automationErrorResponse, ok, readAdminJson, requiredTenantId } from "./shared";

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

export async function GET(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const tenantId = requiredTenantId();
    const agentId = new URL(request.url).searchParams.get("agent_id") || undefined;
    const schedules = await listMaSchedules(tenantId, agentId ? { agentId } : undefined);
    const summary = await getMaScheduleRunSummary(tenantId, schedules.map((item) => item.id));
    return ok({
      schedules: schedules.map((item) => toMaScheduleRecord(item, summary.get(item.id) ?? EMPTY_SUMMARY)),
    });
  } catch (error) {
    return automationErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = await readAdminJson(request);
    assertAdminKeys(body, KEYS);
    const tenantId = requiredTenantId();
    const schedule = await createMaSchedule(tenantId, body, auth.session.userId);
    const summary = await getMaScheduleRunSummary(tenantId, [schedule.id]);
    return ok({ schedule: toMaScheduleRecord(schedule, summary.get(schedule.id) ?? EMPTY_SUMMARY) });
  } catch (error) {
    return automationErrorResponse(error);
  }
}
