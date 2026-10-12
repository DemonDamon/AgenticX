import { NextResponse } from "next/server";
import { getSessionFromCookies } from "../../../../lib/session";
import { listAvailableModelsForUser, readDeptDefaultModelForUser } from "../../../../lib/admin-providers-reader";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json(
      { error: { code: "40101", message: "unauthorized" } },
      { status: 401 }
    );
  }
  const deptId = session.deptId ?? undefined;
  const [models, deptDefaultModelId] = await Promise.all([
    listAvailableModelsForUser(session.userId, session.email, deptId),
    readDeptDefaultModelForUser(session.userId, session.email, deptId),
  ]);
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { models, deptDefaultModelId },
  });
}
