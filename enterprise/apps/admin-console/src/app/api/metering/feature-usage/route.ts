import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../lib/admin-auth";
import { readFeatureUsageTrend } from "../../../../lib/feature-usage-report";

function usageDay(value: unknown, fallback: Date): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const parsed = raw ? new Date(raw) : fallback;
  const date = Number.isNaN(parsed.getTime()) ? fallback : parsed;
  return date.toISOString().slice(0, 10);
}

function idList(value: unknown): string[] | null {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((item) => item.trim()).filter(Boolean);
  }
  return null;
}

/**
 * Aggregate search calls and deep-research runs over a date range.
 * Optional department and user filters narrow the same counters the gates use.
 */
export async function POST(request: Request) {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ code: "40001", message: "body must be an object" }, { status: 400 });
  }

  const deptIds = idList(body.dept_id);
  const userIds = idList(body.user_id);
  if (!deptIds || !userIds) {
    return NextResponse.json({ code: "40001", message: "dept_id and user_id must be strings" }, { status: 400 });
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  try {
    const result = await readFeatureUsageTrend({
      tenantId: guard.session.tenantId,
      fromDay: usageDay(body.start, weekAgo),
      toDay: usageDay(body.end, now),
      deptIds,
      userIds,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: result });
  } catch {
    return NextResponse.json(
      { code: "50001", message: "用量暂时无法汇总", data: { points: [], totals: null } },
      { status: 500 },
    );
  }
}
