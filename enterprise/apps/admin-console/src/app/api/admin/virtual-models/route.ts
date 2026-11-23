import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../lib/admin-auth";
import { createVirtualModel, listVirtualModels } from "../../../../lib/virtual-models-store";
import { validateVirtualModelInput } from "../../../../lib/virtual-models-shared";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const virtualModels = await listVirtualModels();
    return NextResponse.json({ code: "00000", message: "ok", data: { virtualModels } });
  } catch (error) {
    return NextResponse.json(
      { code: "50000", message: error instanceof Error ? error.message : "load failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:create"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    validateVirtualModelInput(body);
    const virtualModel = await createVirtualModel(body);
    return NextResponse.json({ code: "00000", message: "ok", data: { virtualModel } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "invalid request" },
      { status: 400 },
    );
  }
}
