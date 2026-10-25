import { NextResponse } from "next/server";
import { createMaWebhook, listMaWebhooks } from "@agenticx/iam-core";

import { maErrorFromException } from "../../../../../lib/ma/errors";
import { assertOnlyKeys, readJsonObject } from "../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../lib/ma/pat-auth";
import { toMaWebhookRecord } from "../../../../../lib/ma/webhook-records";

export const dynamic = "force-dynamic";

const KEYS = ["name", "url", "event_types", "agent_ids", "sources", "include_result_text", "enabled"] as const;

export async function GET(request: Request) {
  const auth = await requireMaPat(request, "ma:webhooks:read");
  if (!auth.ok) return auth.response;
  try {
    const webhooks = await listMaWebhooks(auth.identity.tenantId);
    return NextResponse.json({ data: webhooks.map(toMaWebhookRecord) });
  } catch (error) {
    return maErrorFromException(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireMaPat(request, "ma:webhooks:write");
  if (!auth.ok) return auth.response;
  try {
    const body = await readJsonObject(request);
    assertOnlyKeys(body, KEYS);
    const created = await createMaWebhook(auth.identity.tenantId, body, auth.identity.userId);
    return NextResponse.json(
      { webhook: toMaWebhookRecord(created.webhook), signing_secret: created.signingSecret },
      { status: 201 },
    );
  } catch (error) {
    return maErrorFromException(error);
  }
}
