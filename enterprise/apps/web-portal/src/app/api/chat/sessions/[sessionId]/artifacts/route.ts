import { NextResponse } from "next/server";
import { getSessionFromCookies } from "../../../../../../lib/session";
import { isChatSessionOwned } from "../../../../../../lib/chat-history";
import { toChatHistoryContext } from "../../../../../../lib/chat-history-http";
import { defaultArtifactStore } from "../../../../../../lib/deep-research/artifact-store";

type Params = Promise<{ sessionId: string }>;

export async function GET(_request: Request, segmentData: { params: Params }) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json(
      { error: { code: "40101", message: "unauthorized" } },
      { status: 401 },
    );
  }
  const { sessionId } = await segmentData.params;
  if (!sessionId?.trim()) {
    return NextResponse.json(
      { error: { code: "40001", message: "missing session id" } },
      { status: 400 },
    );
  }

  const ctx = toChatHistoryContext(session);
  const owned = await isChatSessionOwned(ctx, sessionId);
  if (!owned) {
    return NextResponse.json(
      { error: { code: "40401", message: "session not found" } },
      { status: 404 },
    );
  }

  const artifacts = await defaultArtifactStore.listBySession(
    session.tenantId,
    session.userId,
    sessionId,
  );

  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: {
      artifacts: artifacts.map((a) => ({
        id: a.id,
        path: a.path,
        title: a.title,
        kind: a.kind,
        mimeType: a.mimeType,
        byteSize: a.byteSize,
        createdAt: a.createdAt,
        runId: a.runId,
      })),
    },
  });
}
