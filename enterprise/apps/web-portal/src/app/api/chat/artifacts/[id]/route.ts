import { NextResponse } from "next/server";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../../lib/session";
import { defaultArtifactStore } from "../../../../../lib/deep-research/artifact-store";

type Params = Promise<{ id: string }>;

export async function GET(_request: Request, segmentData: { params: Params }) {
  const session = await getSessionFromCookies();
  if (session?.mustChangePassword) {
    return passwordChangeRequiredResponse();
  }
  if (!session) {
    return NextResponse.json(
      { error: { code: "40101", message: "unauthorized" } },
      { status: 401 },
    );
  }
  const { id } = await segmentData.params;
  if (!id?.trim()) {
    return NextResponse.json(
      { error: { code: "40001", message: "missing artifact id" } },
      { status: 400 },
    );
  }

  const artifact = await defaultArtifactStore.get(session.tenantId, session.userId, id);
  if (!artifact) {
    return NextResponse.json(
      { error: { code: "40401", message: "artifact not found" } },
      { status: 404 },
    );
  }

  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { artifact },
  });
}
