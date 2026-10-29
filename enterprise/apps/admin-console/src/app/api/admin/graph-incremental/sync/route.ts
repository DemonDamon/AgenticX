import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  appendSyncReport,
  listSyncRuns,
  runMockSync,
  type SyncReportRow,
} from "../../../../../lib/graph-incremental-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const runs = await listSyncRuns();
    return NextResponse.json({ code: "00000", message: "ok", data: { runs } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load sync runs";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      mode?: "mock" | "append";
      actor?: string;
      force_changed_ids?: string[];
      report?: Partial<SyncReportRow>;
    };
    if (body.mode === "append" && body.report) {
      const report = await appendSyncReport(body.report);
      return NextResponse.json({ code: "00000", message: "ok", data: { report } });
    }
    const report = await runMockSync({
      actor: body.actor || "admin",
      forceChangedIds: body.force_changed_ids,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { report } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "sync failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
