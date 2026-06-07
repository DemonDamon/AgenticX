import { NextResponse } from "next/server";
import { createSplitRule, deleteSplitRule, listSplitRules, updateSplitRule } from "../../../../../lib/billing-service";
import { requireAdminScope } from "../../../../../lib/admin-auth";

export async function GET() {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) return guard.response;
  try {
    const result = await listSplitRules();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message, data: { items: [] } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = await requireAdminScope(["metering:manage"]);
  if (!guard.ok) return guard.response;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return NextResponse.json({ code: "40002", message: "name required" }, { status: 400 });
  }
  if (typeof body.effective_start !== "string") {
    return NextResponse.json({ code: "40003", message: "effective_start required" }, { status: 400 });
  }
  if (!Array.isArray(body.participants) || body.participants.length === 0) {
    return NextResponse.json({ code: "40004", message: "participants required" }, { status: 400 });
  }
  try {
    const result = await createSplitRule({
      name: body.name.trim(),
      effective_start: body.effective_start,
      effective_end: typeof body.effective_end === "string" ? body.effective_end : null,
      split_mode: body.split_mode === "by_billing_item" ? "by_billing_item" : "fixed_ratio",
      participants: body.participants as Array<{ participant_id: string; label?: string; ratio_bps: number; billing_item?: string }>,
      billing_items: Array.isArray(body.billing_items)
        ? body.billing_items.filter((item): item is string => typeof item === "string")
        : null,
      enabled: body.enabled !== false,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const guard = await requireAdminScope(["metering:manage"]);
  if (!guard.ok) return guard.response;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  if (typeof body.id !== "string" || body.id.length === 0) {
    return NextResponse.json({ code: "40002", message: "id required" }, { status: 400 });
  }
  try {
    const result = await updateSplitRule(body.id, {
      name: typeof body.name === "string" ? body.name.trim() : undefined,
      effective_start: typeof body.effective_start === "string" ? body.effective_start : undefined,
      effective_end: body.effective_end === undefined ? undefined : typeof body.effective_end === "string" ? body.effective_end : null,
      split_mode: body.split_mode === "by_billing_item" ? "by_billing_item" : body.split_mode === "fixed_ratio" ? "fixed_ratio" : undefined,
      participants: Array.isArray(body.participants)
        ? (body.participants as Array<{ participant_id: string; label?: string; ratio_bps: number; billing_item?: string }>)
        : undefined,
      billing_items:
        body.billing_items === undefined
          ? undefined
          : Array.isArray(body.billing_items)
            ? body.billing_items.filter((item): item is string => typeof item === "string")
            : null,
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    });
    if (result.code !== "00000") return NextResponse.json(result, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const guard = await requireAdminScope(["metering:manage"]);
  if (!guard.ok) return guard.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ code: "40002", message: "id required" }, { status: 400 });
  try {
    const result = await deleteSplitRule(id);
    if (result.code !== "00000") return NextResponse.json(result, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message }, { status: 500 });
  }
}
