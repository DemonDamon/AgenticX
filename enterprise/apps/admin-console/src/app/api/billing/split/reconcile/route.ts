import { NextResponse } from "next/server";
import { exportReconcileCsv, reconcileSplit } from "../../../../../lib/billing-service";
import { requireAdminScope } from "../../../../../lib/admin-auth";

export async function GET(request: Request) {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const start = url.searchParams.get("start") ?? new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const end = url.searchParams.get("end") ?? new Date().toISOString();
  const participantId = url.searchParams.get("participant_id") ?? undefined;
  const format = url.searchParams.get("format");
  const input = {
    start,
    end,
    participant_id: participantId,
    sync_pending: url.searchParams.get("sync_pending") !== "0",
    sync_limit: Number(url.searchParams.get("sync_limit") ?? 200),
  };
  try {
    if (format === "csv") {
      const csv = await exportReconcileCsv(input);
      return new NextResponse(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="billing-reconcile-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }
    const result = await reconcileSplit(input);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message, data: { rows: [], ledger_entries: [], synced_usage_count: 0 } }, { status: 500 });
  }
}
