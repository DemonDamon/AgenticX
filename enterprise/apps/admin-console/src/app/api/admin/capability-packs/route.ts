import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { createCapabilityPack, listCapabilityPacks } from "../../../../lib/capability-packs-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const packs = await listCapabilityPacks();
    return NextResponse.json({ code: "00000", message: "ok", data: { packs } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load capability packs";
    const hint = /enterprise_capability_packs|relation .* does not exist/i.test(message)
      ? "请先执行 pnpm --filter @agenticx/db-schema db:migrate"
      : message;
    return NextResponse.json({ code: "50000", message: hint }, { status: 500 });
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
      status?: "active" | "disabled";
      metadata?: Record<string, unknown>;
      capabilityIds?: string[];
      assignmentKeys?: string[];
    };
    if (!body.slug?.trim()) {
      return NextResponse.json({ code: "40000", message: "slug required" }, { status: 400 });
    }
    const pack = await createCapabilityPack({
      slug: body.slug.trim(),
      displayName: body.displayName,
      description: body.description,
      status: body.status,
      metadata: body.metadata,
      capabilityIds: body.capabilityIds,
      assignmentKeys: body.assignmentKeys,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { pack } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "create failed" },
      { status: 400 }
    );
  }
}
