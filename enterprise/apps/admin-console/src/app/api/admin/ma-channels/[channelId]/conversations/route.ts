import { listMaChannelConversations, MaChannelValidationError } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { channelAdminError, toMaChannelConversationRecord } from "../../../../../../lib/ma/channel-records";
import { ok, requiredTenantId } from "../../../ma-schedules/shared";

export const dynamic = "force-dynamic";

function readLimit(request: Request): number {
  const raw = new URL(request.url).searchParams.get("limit");
  if (raw == null || raw === "") return 50;
  if (!/^\d+$/.test(raw)) throw new MaChannelValidationError("limit: is invalid");
  const value = Number(raw);
  if (value < 1 || value > 200) throw new MaChannelValidationError("limit: must be between 1 and 200");
  return value;
}

export async function GET(request: Request, context: { params: Promise<{ channelId: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { channelId } = await context.params;
    const conversations = await listMaChannelConversations(requiredTenantId(), channelId, readLimit(request));
    return ok({ conversations: conversations.map(toMaChannelConversationRecord) });
  } catch (error) {
    return channelAdminError(error);
  }
}
