import { listMaScheduleRuns } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { MaRequestError } from "../../../../../../lib/ma/http";
import { toMaScheduleRunRecord } from "../../../../../../lib/ma/schedule-records";
import { automationErrorResponse, ok, requiredTenantId } from "../../shared";

export const dynamic = "force-dynamic";

function readLimit(raw: string | null): number {
  if (raw == null || raw === "") return 50;
  if (!/^\d+$/.test(raw)) throw new MaRequestError("limit is invalid");
  const value = Number(raw);
  if (value < 1 || value > 200) throw new MaRequestError("limit is invalid");
  return value;
}

export async function GET(request: Request, context: { params: Promise<{ scheduleId: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { scheduleId } = await context.params;
    const runs = await listMaScheduleRuns(requiredTenantId(), scheduleId, readLimit(new URL(request.url).searchParams.get("limit")));
    return ok({ runs: runs.map(toMaScheduleRunRecord) });
  } catch (error) {
    return automationErrorResponse(error);
  }
}
