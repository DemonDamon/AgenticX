import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import {
  backfillJob,
  listRuns,
  listWebhookEvents,
  replayJob,
  rerunJob,
  tickJob,
} from "../../../../../../lib/data-jobs-store";

type ActionBody = {
  action?: string;
  job_id?: string;
  snapshot_id?: string;
  scheduled_for?: string;
  force_fail?: boolean;
};

export async function GET(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const jobId = url.searchParams.get("job_id") ?? undefined;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : 50;
    const [runs, webhook_events] = await Promise.all([
      listRuns({ job_id: jobId, limit }),
      listWebhookEvents(),
    ]);
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { runs, webhook_events },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load runs";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as ActionBody;
    const action = String(body.action || "").trim();
    if (action === "tick") {
      const runs = await tickJob({
        job_id: body.job_id,
        force_fail: Boolean(body.force_fail),
        scheduled_for: body.scheduled_for,
      });
      return NextResponse.json({ code: "00000", message: "ok", data: { runs } });
    }
    if (action === "rerun") {
      const run = await rerunJob(body.job_id);
      return NextResponse.json({ code: "00000", message: "ok", data: { run } });
    }
    if (action === "backfill") {
      const run = await backfillJob(body.job_id, String(body.scheduled_for || ""));
      return NextResponse.json({ code: "00000", message: "ok", data: { run } });
    }
    if (action === "replay") {
      const run = await replayJob(body.job_id, String(body.snapshot_id || ""));
      return NextResponse.json({ code: "00000", message: "ok", data: { run } });
    }
    return NextResponse.json(
      { code: "40000", message: "action must be tick|rerun|backfill|replay" },
      { status: 400 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "action failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
