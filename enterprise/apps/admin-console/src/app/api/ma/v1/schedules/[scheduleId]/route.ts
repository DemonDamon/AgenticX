import { NextResponse } from "next/server";
import { deleteMaSchedule, getMaSchedule, getMaScheduleRunSummary, updateMaSchedule } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../lib/ma/errors";
import { assertOnlyKeys, readJsonObject, ULID_RE } from "../../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../../lib/ma/pat-auth";
import { toMaScheduleRecord, type ScheduleSummary } from "../../../../../../lib/ma/schedule-records";

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

async function present(tenantId: string, scheduleId: string) {
  const schedule = await getMaSchedule(tenantId, scheduleId);
  const summary = await getMaScheduleRunSummary(tenantId, [schedule.id]);
  return toMaScheduleRecord(schedule, summary.get(schedule.id) ?? EMPTY_SUMMARY);
}

export async function GET(request: Request, context: { params: Promise<{ scheduleId: string }> }) {
  const auth = await requireMaPat(request, "ma:schedules:read");
  if (!auth.ok) return auth.response;
  try {
    const { scheduleId } = await context.params;
    if (!ULID_RE.test(scheduleId)) return maError("schedule_not_found", "schedule not found");
    return NextResponse.json({ schedule: await present(auth.identity.tenantId, scheduleId) });
  } catch (error) {
    return maErrorFromException(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ scheduleId: string }> }) {
  const auth = await requireMaPat(request, "ma:schedules:write");
  if (!auth.ok) return auth.response;
  try {
    const { scheduleId } = await context.params;
    if (!ULID_RE.test(scheduleId)) return maError("schedule_not_found", "schedule not found");
    const body = await readJsonObject(request);
    assertOnlyKeys(body, KEYS);
    await updateMaSchedule(auth.identity.tenantId, scheduleId, body);
    return NextResponse.json({ schedule: await present(auth.identity.tenantId, scheduleId) });
  } catch (error) {
    return maErrorFromException(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ scheduleId: string }> }) {
  const auth = await requireMaPat(request, "ma:schedules:write");
  if (!auth.ok) return auth.response;
  try {
    const { scheduleId } = await context.params;
    if (!ULID_RE.test(scheduleId)) return maError("schedule_not_found", "schedule not found");
    await deleteMaSchedule(auth.identity.tenantId, scheduleId);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return maErrorFromException(error);
  }
}
