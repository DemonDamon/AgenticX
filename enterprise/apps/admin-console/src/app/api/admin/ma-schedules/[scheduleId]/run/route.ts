import { getMaScheduleRunSummary, requestMaScheduleRun } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { toMaScheduleRecord, type ScheduleSummary } from "../../../../../../lib/ma/schedule-records";
import { automationErrorResponse, ok, requiredTenantId } from "../../shared";

export const dynamic = "force-dynamic";

const EMPTY_SUMMARY: ScheduleSummary = { nextRunAt: null, lastRun: null };

export async function POST(_request: Request, context: { params: Promise<{ scheduleId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { scheduleId } = await context.params;
    const tenantId = requiredTenantId();
    const schedule = await requestMaScheduleRun(tenantId, scheduleId);
    const summary = await getMaScheduleRunSummary(tenantId, [schedule.id]);
    return ok({ schedule: toMaScheduleRecord(schedule, summary.get(schedule.id) ?? EMPTY_SUMMARY) });
  } catch (error) {
    return automationErrorResponse(error);
  }
}
