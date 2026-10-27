import { deleteMaChannel, getMaChannel, MaChannelNotFoundError, updateMaChannel } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import { channelAdminError, toMaChannelRecord } from "../../../../../lib/ma/channel-records";
import { assertAdminKeys, ok, readAdminJson, requiredTenantId } from "../../ma-schedules/shared";

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

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function requireChannelId(channelId: string): void {
  if (!ULID_RE.test(channelId)) throw new MaChannelNotFoundError();
}

export async function GET(_request: Request, context: { params: Promise<{ channelId: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { channelId } = await context.params;
    requireChannelId(channelId);
    return ok({ channel: toMaChannelRecord(await getMaChannel(requiredTenantId(), channelId)) });
  } catch (error) {
    return channelAdminError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ channelId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { channelId } = await context.params;
    requireChannelId(channelId);
    const body = await readAdminJson(request);
    assertAdminKeys(body, KEYS);
    const tenantId = requiredTenantId();
    await updateMaChannel(tenantId, channelId, body);
    return ok({ channel: toMaChannelRecord(await getMaChannel(tenantId, channelId)) });
  } catch (error) {
    return channelAdminError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ channelId: string }> }) {
  const auth = await requireAdminScope(["provider:delete"]);
  if (!auth.ok) return auth.response;
  try {
    const { channelId } = await context.params;
    requireChannelId(channelId);
    await deleteMaChannel(requiredTenantId(), channelId);
    return ok({ deleted: true });
  } catch (error) {
    return channelAdminError(error);
  }
}
