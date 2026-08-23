import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { deleteSkill, getSkill, updateSkill } from "../../../../../lib/capability-packs-store";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const skill = await getSkill(id);
  if (!skill) return NextResponse.json({ code: "40400", message: "skill not found" }, { status: 404 });
  return NextResponse.json({ code: "00000", message: "ok", data: { skill } });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const skill = await updateSkill(id, {
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      version: typeof body.version === "string" ? body.version : undefined,
      bundleUri: typeof body.bundleUri === "string" ? body.bundleUri : undefined,
      bundleDigest: typeof body.bundleDigest === "string" ? body.bundleDigest : undefined,
      requiredCapabilities: Array.isArray(body.requiredCapabilities)
        ? (body.requiredCapabilities as string[])
        : undefined,
      status: body.status === "active" || body.status === "disabled" ? body.status : undefined,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { skill } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "update failed";
    const status = message === "skill not found" ? 404 : 400;
    return NextResponse.json({ code: status === 404 ? "40400" : "40000", message }, { status });
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const removed = await deleteSkill(id);
  if (!removed) return NextResponse.json({ code: "40400", message: "skill not found" }, { status: 404 });
  return NextResponse.json({ code: "00000", message: "ok", data: { id } });
}
