import { NextResponse } from "next/server";
import { queryHeatmap } from "../../../../lib/metering-service";
import { requireAdminScope } from "../../../../lib/admin-auth";

const DIMENSIONS = new Set(["dept", "user", "model", "pat", "provider"]);
const GRANULARITIES = new Set(["hour", "day"]);
const METRICS = new Set(["total_tokens", "cost_usd"]);

export async function POST(request: Request) {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) {
    return guard.response;
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }

  const toArray = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];

  const dimension = typeof body.dimension === "string" && DIMENSIONS.has(body.dimension) ? body.dimension : "dept";
  const timeGranularity =
    typeof body.time_granularity === "string" && GRANULARITIES.has(body.time_granularity) ? body.time_granularity : "day";
  const metric = typeof body.metric === "string" && METRICS.has(body.metric) ? body.metric : "total_tokens";

  try {
    const result = await queryHeatmap({
      dimension: dimension as "dept" | "user" | "model" | "pat" | "provider",
      time_granularity: timeGranularity as "hour" | "day",
      metric: metric as "total_tokens" | "cost_usd",
      dept_id: toArray(body.dept_id),
      user_id: toArray(body.user_id),
      api_token_id: toArray(body.api_token_id),
      provider: toArray(body.provider),
      model: toArray(body.model),
      start: typeof body.start === "string" ? body.start : new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
      end: typeof body.end === "string" ? body.end : new Date().toISOString(),
      limit_dimensions: typeof body.limit_dimensions === "number" ? body.limit_dimensions : 30,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        code: "50001",
        message,
        data: { dimension, time_granularity: timeGranularity, metric, dimensions: [], time_slots: [], cells: [] },
      },
      { status: 500 }
    );
  }
}
