import { NextResponse } from "next/server";
import { deleteMaChannel, getMaChannel, updateMaChannel } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../lib/ma/errors";
import { assertOnlyKeys, readJsonObject, ULID_RE } from "../../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../../lib/ma/pat-auth";
import { toMaChannelRecord } from "../../../../../../lib/ma/channel-records";

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

export async function GET(request: Request, context: { params: Promise<{ channelId: string }> }) {
  const auth = await requireMaPat(request, "ma:channels:read");
  if (!auth.ok) return auth.response;
  try {
    const { channelId } = await context.params;
    if (!ULID_RE.test(channelId)) return maError("channel_not_found", "channel not found");
    return NextResponse.json({ channel: toMaChannelRecord(await getMaChannel(auth.identity.tenantId, channelId)) });
  } catch (error) {
    return maErrorFromException(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ channelId: string }> }) {
  const auth = await requireMaPat(request, "ma:channels:write");
  if (!auth.ok) return auth.response;
  try {
    const { channelId } = await context.params;
    if (!ULID_RE.test(channelId)) return maError("channel_not_found", "channel not found");
    const body = await readJsonObject(request);
    assertOnlyKeys(body, KEYS);
    await updateMaChannel(auth.identity.tenantId, channelId, body);
    return NextResponse.json({ channel: toMaChannelRecord(await getMaChannel(auth.identity.tenantId, channelId)) });
  } catch (error) {
    return maErrorFromException(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ channelId: string }> }) {
  const auth = await requireMaPat(request, "ma:channels:write");
  if (!auth.ok) return auth.response;
  try {
    const { channelId } = await context.params;
    if (!ULID_RE.test(channelId)) return maError("channel_not_found", "channel not found");
    await deleteMaChannel(auth.identity.tenantId, channelId);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return maErrorFromException(error);
  }
}
