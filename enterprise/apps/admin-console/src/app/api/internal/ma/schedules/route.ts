import { NextResponse } from "next/server";
import { listEnabledMaSchedulesForRuntime } from "@agenticx/iam-core";

import { maErrorFromException } from "../../../../../lib/ma/errors";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../lib/ma/internal-auth";
import { toMaScheduleRuntimeRecord } from "../../../../../lib/ma/schedule-records";

export const dynamic = "force-dynamic";

function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(request: Request) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  try {
    const snapshot = await listEnabledMaSchedulesForRuntime();
    return noStore(
      NextResponse.json({
        data: snapshot.enabled.map(toMaScheduleRuntimeRecord),
        disabled_ids: snapshot.disabledIds,
      }),
    );
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
