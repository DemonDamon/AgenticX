import { NextResponse } from "next/server";
import { getQuotaSummaryForSession } from "@agenticx/iam-core";
import { getSessionFromCookies } from "../../../../../lib/session";

export async function GET(request: Request) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json(
      { code: "40101", message: "unauthorized" },
      { status: 401 },
    );
  }

  // AC-3: ignore client-supplied identity overrides; only JWT session matters.
  void request;

  try {
    const summary = await getQuotaSummaryForSession({
      tenantId: session.tenantId,
      userId: session.userId,
      deptId: session.deptId,
    });
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message }, { status: 500 });
  }
}
