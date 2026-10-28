import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  listDictionaryFields,
  upsertDictionaryField,
  type DictionaryField,
} from "../../../../../lib/data-suite-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const fields = await listDictionaryFields();
    return NextResponse.json({ code: "00000", message: "ok", data: { fields } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load dictionary";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as Partial<DictionaryField> & { name?: string };
    if (!body.name?.trim()) {
      return NextResponse.json({ code: "40000", message: "name required" }, { status: 400 });
    }
    const field = await upsertDictionaryField({
      name: body.name,
      business_def: body.business_def,
      calc_logic: body.calc_logic,
      update_freq: body.update_freq,
      owner: body.owner,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { field } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "upsert failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
