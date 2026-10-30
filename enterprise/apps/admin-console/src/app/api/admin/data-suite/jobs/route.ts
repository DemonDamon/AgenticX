import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { ensureSampleJob, listJobs, listSchedules } from "../../../../../lib/data-jobs-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    await ensureSampleJob();
    const [jobs, schedules] = await Promise.all([listJobs(), listSchedules()]);
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { jobs, schedules },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load jobs";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}

export async function POST() {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const seeded = await ensureSampleJob();
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: seeded,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "seed failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
