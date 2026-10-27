import { NextResponse } from "next/server";
import { createMaChannel, getMaChannel, listMaChannels } from "@agenticx/iam-core";

import { maErrorFromException } from "../../../../../lib/ma/errors";
import { assertOnlyKeys, readJsonObject } from "../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../lib/ma/pat-auth";
import { toMaChannelRecord } from "../../../../../lib/ma/channel-records";

export const dynamic = "force-dynamic";

const KEYS = [
  "name",
  "platform",
  "agent_id",
  "routing",
  "pinned_version",
  "environment_id",
  "app_id",
  "credential",
  "config",
  "enabled",
] as const;

export async function GET(request: Request) {
  const auth = await requireMaPat(request, "ma:channels:read");
  if (!auth.ok) return auth.response;
  try {
    const agentId = new URL(request.url).searchParams.get("agent_id") || undefined;
    const channels = await listMaChannels(auth.identity.tenantId, agentId ? { agentId } : undefined);
    return NextResponse.json({ data: channels.map(toMaChannelRecord) });
  } catch (error) {
    return maErrorFromException(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireMaPat(request, "ma:channels:write");
  if (!auth.ok) return auth.response;
  try {
    const body = await readJsonObject(request);
    assertOnlyKeys(body, KEYS);
    const created = await createMaChannel(auth.identity.tenantId, body, auth.identity.userId);
    const channel = await getMaChannel(auth.identity.tenantId, created.id);
    return NextResponse.json({ channel: toMaChannelRecord(channel) }, { status: 201 });
  } catch (error) {
    return maErrorFromException(error);
  }
}
