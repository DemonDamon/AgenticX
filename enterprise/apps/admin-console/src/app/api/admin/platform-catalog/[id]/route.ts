import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  getCatalogItem,
  listGrantsForCatalogItem,
  updateCatalogItem,
} from "../../../../../lib/platform-catalog-store";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const item = await getCatalogItem(id);
  if (!item) {
    return NextResponse.json({ code: "40400", message: "catalog item not found" }, { status: 404 });
  }
  const grants = await listGrantsForCatalogItem(id);
  return NextResponse.json({ code: "00000", message: "ok", data: { item, grants } });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const item = await updateCatalogItem(id, {
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      version: typeof body.version === "string" ? body.version : undefined,
      bundleUri: typeof body.bundleUri === "string" ? body.bundleUri : undefined,
      bundleDigest: typeof body.bundleDigest === "string" ? body.bundleDigest : undefined,
      status: body.status === "active" || body.status === "disabled" ? body.status : undefined,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { item } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "update failed" },
      { status: 400 },
    );
  }
}
