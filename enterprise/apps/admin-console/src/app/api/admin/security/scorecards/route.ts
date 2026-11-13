import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import { auditConsoleEvent } from "../../../../../lib/console-audit";
import {
  importScorecard,
  parseScorecardImport,
  readTenantAdmission,
} from "../../../../../lib/model-admission-store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const admission = await readTenantAdmission(auth.session.tenantId);
  return NextResponse.json({
    scorecards: admission.scorecards,
    overrides: admission.overrides,
  });
}

export async function POST(req: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  let card;
  try {
    card = parseScorecardImport(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "invalid scorecard" },
      { status: 400 },
    );
  }
  const imported = await importScorecard(auth.session.tenantId, card);
  await auditConsoleEvent(auth.session, "model_admission.scorecard_imported", "scorecard", {
    runId: card.run_id,
    imported,
  });
  return NextResponse.json({ imported });
}
