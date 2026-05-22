import { NextResponse } from "next/server";
import { queryMetering } from "../../../../lib/metering-service";
import { requireAdminScope } from "../../../../lib/admin-auth";

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

  const result = await queryMetering({
    dept_id: toArray(body.dept_id),
    user_id: toArray(body.user_id),
    api_token_id: toArray(body.api_token_id),
    provider: toArray(body.provider),
    model: toArray(body.model),
    start: typeof body.start === "string" ? body.start : new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
    end: typeof body.end === "string" ? body.end : new Date().toISOString(),
    group_by: toArray(body.group_by) as Array<"dept" | "user" | "provider" | "model" | "day" | "pat">,
  });
  const rows = result.data?.rows ?? [];
  const header = [
    "dept",
    "user",
    "pat",
    "provider",
    "model",
    "day",
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "cached_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
    "cost_usd",
  ];
  const csv = [
    header.join(","),
    ...rows.map((row) =>
      [
        row.dims.dept ?? "",
        row.dims.user ?? "",
        row.dims.pat ?? "",
        row.dims.provider ?? "",
        row.dims.model ?? "",
        row.dims.day ?? "",
        row.input_tokens,
        row.output_tokens,
        row.total_tokens,
        row.cached_tokens ?? 0,
        row.cache_read_input_tokens ?? 0,
        row.cache_creation_input_tokens ?? 0,
        row.cost_usd,
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    ),
  ].join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="metering-export.csv"`,
    },
  });
}

