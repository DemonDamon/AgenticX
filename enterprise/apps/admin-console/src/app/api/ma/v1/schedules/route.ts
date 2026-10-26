import { NextResponse } from "next/server";
import { createMaSchedule, getMaScheduleRunSummary, listMaSchedules } from "@agenticx/iam-core";

import { maErrorFromException } from "../../../../../lib/ma/errors";
import { assertOnlyKeys, readJsonObject } from "../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../lib/ma/pat-auth";
import { toMaScheduleRecord, type ScheduleSummary } from "../../../../../lib/ma/schedule-records";
import { emitMaResourceEvent } from "../../../../../lib/ma/webhook-events";

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
  const auth = await requireMaPat(request, "ma:schedules:read");
  if (!auth.ok) return auth.response;
  try {
    const agentId = new URL(request.url).searchParams.get("agent_id") || undefined;
    const schedules = await listMaSchedules(auth.identity.tenantId, agentId ? { agentId } : undefined);
    const summary = await getMaScheduleRunSummary(
      auth.identity.tenantId,
      schedules.map((item) => item.id),
    );
    return NextResponse.json({
      data: schedules.map((item) => toMaScheduleRecord(item, summary.get(item.id) ?? EMPTY_SUMMARY)),
    });
  } catch (error) {
    return maErrorFromException(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireMaPat(request, "ma:schedules:write");
  if (!auth.ok) return auth.response;
  try {
    const body = await readJsonObject(request);
    assertOnlyKeys(body, KEYS);
    const schedule = await createMaSchedule(auth.identity.tenantId, body, auth.identity.userId);
    emitMaResourceEvent({
      tenantId: auth.identity.tenantId,
      type: "schedule.created",
      resourceId: schedule.id,
      extra: { agent_id: schedule.agentId },
    });
    const summary = await getMaScheduleRunSummary(auth.identity.tenantId, [schedule.id]);
    return NextResponse.json(
      { schedule: toMaScheduleRecord(schedule, summary.get(schedule.id) ?? EMPTY_SUMMARY) },
      { status: 201 },
    );
  } catch (error) {
    return maErrorFromException(error);
  }
}
