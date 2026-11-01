import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import {
  createCatalogVersion,
  listCatalogVersions,
} from "../../../../../../lib/platform-catalog-store";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const versions = await listCatalogVersions(id);
  return NextResponse.json({ code: "00000", message: "ok", data: { versions } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    const body = (await request.json()) as {
      version?: string;
      bundleUri?: string;
      bundleDigest?: string;
    };
    if (!body.version?.trim()) {
      return NextResponse.json({ code: "40000", message: "version required" }, { status: 400 });
    }
    const version = await createCatalogVersion(id, {
      version: body.version.trim(),
      bundleUri: body.bundleUri,
      bundleDigest: body.bundleDigest,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { version } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "create version failed" },
      { status: 400 },
    );
  }
}
