import { NextResponse } from "next/server";
import { listMaScheduleRuns } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../lib/ma/errors";
import { MaRequestError, ULID_RE } from "../../../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../../../lib/ma/pat-auth";
import { toMaScheduleRunRecord } from "../../../../../../../lib/ma/schedule-records";

export const dynamic = "force-dynamic";

function readLimit(raw: string | null): number {
  if (raw == null || raw === "") return 50;
  if (!/^\d+$/.test(raw)) throw new MaRequestError("limit is invalid");
  const value = Number(raw);
  if (value < 1 || value > 200) throw new MaRequestError("limit is invalid");
  return value;
}

export async function GET(request: Request, context: { params: Promise<{ scheduleId: string }> }) {
  const auth = await requireMaPat(request, "ma:schedules:read");
  if (!auth.ok) return auth.response;
  try {
    const { scheduleId } = await context.params;
    if (!ULID_RE.test(scheduleId)) return maError("schedule_not_found", "schedule not found");
    const limit = readLimit(new URL(request.url).searchParams.get("limit"));
    const runs = await listMaScheduleRuns(auth.identity.tenantId, scheduleId, limit);
    return NextResponse.json({ data: runs.map(toMaScheduleRunRecord) });
  } catch (error) {
    return maErrorFromException(error);
  }
}
