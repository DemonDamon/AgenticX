import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import {
  createCatalogItem,
  listCatalogItems,
} from "../../../../lib/platform-catalog-store";

function migrationHint(message: string): string {
  return /platform_catalog_items|tenant_distribution_grants|relation .* does not exist/i.test(message)
    ? "请先执行 pnpm --filter @agenticx/db-schema db:migrate"
    : message;
}

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const items = await listCatalogItems();
    return NextResponse.json({ code: "00000", message: "ok", data: { items } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load catalog";
    return NextResponse.json({ code: "50000", message: migrationHint(message) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as {
      slug?: string;
      displayName?: string;
      description?: string;
      resourceType?: string;
      version?: string;
      bundleUri?: string;
      bundleDigest?: string;
      status?: "active" | "disabled";
      packManifest?: Record<string, unknown>;
    };
    if (!body.slug?.trim()) {
      return NextResponse.json({ code: "40000", message: "slug required" }, { status: 400 });
    }
    const item = await createCatalogItem({
      slug: body.slug.trim(),
      displayName: body.displayName,
      description: body.description,
      resourceType: body.resourceType,
      version: body.version,
      bundleUri: body.bundleUri,
      bundleDigest: body.bundleDigest,
      status: body.status,
      packManifest: body.packManifest,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { item } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "create failed" },
      { status: 400 },
    );
  }
}