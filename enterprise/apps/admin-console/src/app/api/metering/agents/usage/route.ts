import { NextResponse } from "next/server";
import { QuotaTimeZoneError, type AgentUsageGroupKey } from "@agenticx/feature-metering";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import { queryAgentUsage } from "../../../../../lib/metering-service";

const GROUP_KEYS = ["agent", "user", "dept", "model", "day"] as const;

function isGroupKey(value: string): value is AgentUsageGroupKey {
  return (GROUP_KEYS as readonly string[]).includes(value);
}

function parseGroupBy(value: unknown): AgentUsageGroupKey[] | string {
  if (!Array.isArray(value)) return "group_by: is required";
  const out: AgentUsageGroupKey[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !isGroupKey(item)) return "group_by: unknown item";
    if (!out.includes(item)) out.push(item);
  }
  if (out.length < 1 || out.length > 3) return "group_by: must contain 1 to 3 items";
  return out;
}

function toArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export async function POST(request: Request) {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) return guard.response;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "40001", message: "body: invalid json" }, { status: 400 });
  }
  const groupBy = parseGroupBy(body.group_by);
  if (typeof groupBy === "string") {
    return NextResponse.json({ code: "40001", message: groupBy }, { status: 400 });
  }
  try {
    const data = await queryAgentUsage({
      start: typeof body.start === "string" ? body.start : undefined,
      end: typeof body.end === "string" ? body.end : undefined,
      agent_id: toArray(body.agent_id),
      user_id: toArray(body.user_id),
      group_by: groupBy,
    });
    return NextResponse.json({ code: "00000", message: "ok", data });
  } catch (error) {
    if (error instanceof QuotaTimeZoneError) {
      return NextResponse.json({ code: "50001", message: error.message }, { status: 500 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message, data: { rows: [] } }, { status: 500 });
  }
}
