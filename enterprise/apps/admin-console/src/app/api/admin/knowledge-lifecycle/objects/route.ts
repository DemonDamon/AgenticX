import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  listObjects,
  upsertObject,
  type KnowledgeObjectRow,
} from "../../../../../lib/knowledge-lifecycle-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const objects = await listObjects();
    return NextResponse.json({ code: "00000", message: "ok", data: { objects } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load objects";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as Partial<KnowledgeObjectRow> & {
      id?: string;
      kind?: string;
      bump_version?: boolean;
      actor?: string;
    };
    if (!body.id?.trim() || !body.kind?.trim()) {
      return NextResponse.json({ code: "40000", message: "id and kind required" }, { status: 400 });
    }
    const object = await upsertObject(
      {
        id: body.id,
        kind: body.kind,
        status: body.status,
        version: body.version,
        attrs: body.attrs,
        relations: body.relations,
        source_ids: body.source_ids,
        meta: body.meta,
      },
      { actor: body.actor || "admin", bumpVersion: Boolean(body.bump_version) },
    );
    return NextResponse.json({ code: "00000", message: "ok", data: { object } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "upsert failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
