import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../lib/admin-auth";
import {
  getDesktopAgentPolicy,
  setDesktopAgentPolicy,
} from "../../../../lib/desktop-agent-policy-store";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "save failed");
  return NextResponse.json({ code: "50000", message }, { status: 500 });
}

function policyInput(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  if (record.policy && typeof record.policy === "object" && !Array.isArray(record.policy)) {
    return record.policy;
  }
  return record;
}

export async function GET() {
  const guard = await requireAdminScope(["policy:read"]);
  if (!guard.ok) return guard.response;
  try {
    const policy = await getDesktopAgentPolicy();
    return NextResponse.json({ code: "00000", message: "ok", data: { policy } });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  const guard = await requireAdminScope(["policy:update"]);
  if (!guard.ok) return guard.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  try {
    const policy = await setDesktopAgentPolicy(policyInput(body));
    return NextResponse.json({ code: "00000", message: "ok", data: { policy } });
  } catch (error) {
    return failure(error);
  }
}
