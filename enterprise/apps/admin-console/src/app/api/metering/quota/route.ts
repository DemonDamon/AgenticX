import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/admin-auth";
import { getQuotaConfig, quotaFilePath, setQuotaConfig } from "../../../../lib/token-quota-store";

export async function GET() {
  const guard = await requireAdminSession();
  if (!guard.ok) return guard.response;
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { quota: getQuotaConfig(), file: quotaFilePath() },
  });
}

export async function PUT(request: Request) {
  const guard = await requireAdminSession();
  if (!guard.ok) return guard.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  const quota = setQuotaConfig((body as Record<string, unknown>) ?? {});
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { quota, file: quotaFilePath() },
  });
}
