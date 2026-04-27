import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../../lib/admin-auth";
import { addProviderModel, type ProviderModel } from "../../../../../../lib/model-providers-store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const model: ProviderModel = {
      name: typeof body.name === "string" ? body.name : "",
      label: typeof body.label === "string" ? body.label : "",
      capabilities:
        Array.isArray(body.capabilities) && body.capabilities.every((c): c is string => typeof c === "string")
          ? (body.capabilities as string[])
          : ["text"],
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    };
    const updated = addProviderModel(id, model);
    return NextResponse.json({ code: "00000", message: "ok", data: { provider: updated } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid request";
    const status = message === "provider not found" ? 404 : 400;
    return NextResponse.json(
      { code: status === 404 ? "40400" : "40000", message },
      { status }
    );
  }
}
