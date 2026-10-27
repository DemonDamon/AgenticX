import { NextResponse } from "next/server";
import { getMaScheduleRunSummary, requestMaScheduleRun } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../lib/ma/errors";
import { ULID_RE } from "../../../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../../../lib/ma/pat-auth";
import { toMaScheduleRecord, type ScheduleSummary } from "../../../../../../../lib/ma/schedule-records";

export const dynamic = "force-dynamic";

const EMPTY_SUMMARY: ScheduleSummary = { nextRunAt: null, lastRun: null };

export async function POST(request: Request, context: { params: Promise<{ scheduleId: string }> }) {
  const auth = await requireMaPat(request, "ma:schedules:write");
  if (!auth.ok) return auth.response;
  try {
    const { scheduleId } = await context.params;
    if (!ULID_RE.test(scheduleId)) return maError("schedule_not_found", "schedule not found");
    const schedule = await requestMaScheduleRun(auth.identity.tenantId, scheduleId);
    const summary = await getMaScheduleRunSummary(auth.identity.tenantId, [schedule.id]);
    return NextResponse.json(
      { schedule: toMaScheduleRecord(schedule, summary.get(schedule.id) ?? EMPTY_SUMMARY) },
      { status: 202 },
    );
  } catch (error) {
    return maErrorFromException(error);
  }
}
