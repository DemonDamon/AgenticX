import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { fetchUpstreamModels } from "../../../../../../lib/fetch-upstream-models";
import { getProviderInternal } from "../../../../../../lib/model-providers-store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const provider = await getProviderInternal(id);
  if (!provider) {
    return NextResponse.json({ code: "40400", message: "provider not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    apiKey?: string;
    baseUrl?: string;
  };
  const apiKey = (body.apiKey ?? provider.apiKey ?? "").trim();
  const baseUrl = (body.baseUrl ?? provider.baseUrl).trim();

  const result = await fetchUpstreamModels({
    providerId: id,
    apiKey,
    baseUrl,
  });

  if (!result.ok) {
    return NextResponse.json(
      { code: "40000", message: result.error, data: { models: [] as string[] } },
      { status: 400 }
    );
  }

  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: {
      models: result.models,
      warning: result.warning,
    },
  });
}
