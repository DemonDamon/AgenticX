import { createMaChannel, getMaChannel, listMaChannels } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../lib/admin-auth";
import { channelAdminError, toMaChannelRecord } from "../../../../lib/ma/channel-records";
import { assertAdminKeys, ok, readAdminJson, requiredTenantId } from "../ma-schedules/shared";

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
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const tenantId = requiredTenantId();
    const agentId = new URL(request.url).searchParams.get("agent_id") || undefined;
    const channels = await listMaChannels(tenantId, agentId ? { agentId } : undefined);
    return ok({ channels: channels.map(toMaChannelRecord) });
  } catch (error) {
    return channelAdminError(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = await readAdminJson(request);
    assertAdminKeys(body, KEYS);
    const tenantId = requiredTenantId();
    const created = await createMaChannel(tenantId, body, auth.session.userId);
    const channel = await getMaChannel(tenantId, created.id);
    return ok({ channel: toMaChannelRecord(channel) });
  } catch (error) {
    return channelAdminError(error);
  }
}
