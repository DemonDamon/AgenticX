import { NextResponse } from "next/server";
import { queryMetering } from "../../../../lib/metering-service";

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const toArray = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];

  const result = await queryMetering({
    dept_id: toArray(body.dept_id),
    user_id: toArray(body.user_id),
    provider: toArray(body.provider),
    model: toArray(body.model),
    start: typeof body.start === "string" ? body.start : new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
    end: typeof body.end === "string" ? body.end : new Date().toISOString(),
    group_by: toArray(body.group_by) as Array<"dept" | "user" | "provider" | "model" | "day">,
  });
  return NextResponse.json(result);
}

