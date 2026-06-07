import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { getPricingConfig, setPricingConfig } from "../../../../lib/pricing-store";

export async function GET() {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { pricing: await getPricingConfig() },
  });
}

export async function PUT(request: Request) {
  const guard = await requireAdminScope(["metering:manage"]);
  if (!guard.ok) return guard.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  const pricing = await setPricingConfig((body as Record<string, unknown>) ?? {});
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { pricing },
  });
}
