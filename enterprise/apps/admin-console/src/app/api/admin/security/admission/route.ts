import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import { auditConsoleEvent } from "../../../../../lib/console-audit";
import { readTenantAdmission, writeThreshold } from "../../../../../lib/model-admission-store";

export const runtime = "nodejs";

function validateThreshold(input: unknown): { enabled: boolean; minScore: number; requireScorecard: boolean } | null {
  if (!input || typeof input !== "object") return null;
  const { enabled, minScore, requireScorecard } = input as Record<string, unknown>;
  if (
    typeof enabled !== "boolean" ||
    typeof requireScorecard !== "boolean" ||
    typeof minScore !== "number" ||
    !Number.isInteger(minScore) ||
    minScore < 0 ||
    minScore > 100
  ) {
    return null;
  }
  return { enabled, minScore, requireScorecard };
}

export async function GET(req: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const admission = await readTenantAdmission(auth.session.tenantId);
  return NextResponse.json({ threshold: admission.threshold });
}

export async function PUT(req: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const threshold = validateThreshold(body);
  if (!threshold) {
    return NextResponse.json(
      { error: "invalid threshold: {enabled: boolean, minScore: 0-100, requireScorecard: boolean}" },
      { status: 400 },
    );
  }
  const tenant = await writeThreshold(auth.session.tenantId, threshold);
  await auditConsoleEvent(auth.session, "model_admission.threshold_updated", "model_admission", {
    threshold,
  });
  return NextResponse.json({ threshold: tenant.threshold });
}
