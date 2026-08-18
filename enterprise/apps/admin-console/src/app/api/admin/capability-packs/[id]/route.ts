import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  deleteCapabilityPack,
  getCapabilityPack,
  updateCapabilityPack,
} from "../../../../../lib/capability-packs-store";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const pack = await getCapabilityPack(id);
  if (!pack) return NextResponse.json({ code: "40400", message: "pack not found" }, { status: 404 });
  return NextResponse.json({ code: "00000", message: "ok", data: { pack } });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const pack = await updateCapabilityPack(id, {
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      status: body.status === "active" || body.status === "disabled" ? body.status : undefined,
      metadata:
        body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
          ? (body.metadata as Record<string, unknown>)
          : undefined,
      capabilityIds: Array.isArray(body.capabilityIds) ? (body.capabilityIds as string[]) : undefined,
      assignmentKeys: Array.isArray(body.assignmentKeys) ? (body.assignmentKeys as string[]) : undefined,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { pack } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "update failed";
    const status = message === "pack not found" ? 404 : 400;
    return NextResponse.json({ code: status === 404 ? "40400" : "40000", message }, { status });
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const removed = await deleteCapabilityPack(id);
  if (!removed) return NextResponse.json({ code: "40400", message: "pack not found" }, { status: 404 });
  return NextResponse.json({ code: "00000", message: "ok", data: { id } });
}
