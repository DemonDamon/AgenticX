import { NextResponse } from "next/server";
import { queryMetering } from "../../../../lib/metering-service";
import { requireAdminSession } from "../../../../lib/admin-auth";

export async function POST(request: Request) {
  const guard = await requireAdminSession();
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

  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { code: "50001", message, data: { rows: [] } },
      { status: 500 }
    );
  }
}

