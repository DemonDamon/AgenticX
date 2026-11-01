import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { getCatalogItem, listGrantsForCatalogItem } from "../../../../../lib/platform-catalog-store";

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
