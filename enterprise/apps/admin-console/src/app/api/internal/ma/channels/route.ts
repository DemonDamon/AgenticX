import { NextResponse } from "next/server";
import { listEnabledMaChannelsForRuntime } from "@agenticx/iam-core";

import { maErrorFromException } from "../../../../../lib/ma/errors";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../lib/ma/internal-auth";
import { toMaChannelRuntimeRecord } from "../../../../../lib/ma/channel-records";

export const dynamic = "force-dynamic";

function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(request: Request) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  try {
    const channels = await listEnabledMaChannelsForRuntime();
    return noStore(NextResponse.json({ data: channels.map(toMaChannelRuntimeRecord) }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
