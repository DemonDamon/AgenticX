import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  listCleaningRules,
  upsertCleaningRule,
  type CleaningRule,
} from "../../../../../lib/data-suite-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const rules = await listCleaningRules();
    return NextResponse.json({ code: "00000", message: "ok", data: { rules } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load cleaning rules";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as Partial<CleaningRule> & { id?: string };
    if (!body.id?.trim()) {
      return NextResponse.json({ code: "40000", message: "id required" }, { status: 400 });
    }
    const rule = await upsertCleaningRule({
      id: body.id,
      template: body.template,
      field: body.field,
      params: body.params,
      enabled: body.enabled,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { rule } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "upsert failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
