import { NextResponse } from "next/server";
import { listAgentsVisibleToKeys, resolveAssignmentKeysForUser } from "@agenticx/iam-core";
import { getSessionFromCookies } from "../../../../lib/session";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: { code: "40101", message: "unauthorized" } }, { status: 401 });
  }
  const keys = await resolveAssignmentKeysForUser(
    session.tenantId,
    session.userId,
    session.email,
    session.deptId,
  );
  const agents = await listAgentsVisibleToKeys(session.tenantId, keys);
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: {
      agents: agents.map((agent) => ({
        id: agent.id,
        slug: agent.slug,
        displayName: agent.displayName,
        description: agent.description,
        runtime: agent.runtime,
        model: agent.model,
      })),
    },
  });
}
