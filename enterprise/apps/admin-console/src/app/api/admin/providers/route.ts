import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import {
  createProvider,
  listProviders,
  PROVIDER_TEMPLATES,
  type CreateProviderInput,
  type ProviderRoute,
} from "../../../../lib/model-providers-store";

function parseRoute(value: unknown): ProviderRoute | undefined {
  if (value === "local" || value === "private-cloud" || value === "third-party") return value;
  return undefined;
}

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: {
      providers: await listProviders(),
      templates: PROVIDER_TEMPLATES,
    },
  });
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:create"]);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const input: CreateProviderInput = {
      id: typeof body.id === "string" ? body.id : "",
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : "",
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      isDefault: typeof body.isDefault === "boolean" ? body.isDefault : undefined,
      route: parseRoute(body.route),
      envKey: typeof body.envKey === "string" ? body.envKey : undefined,
    };
    if (!input.id || !input.baseUrl) {
      return NextResponse.json({ code: "40000", message: "id and baseUrl are required" }, { status: 400 });
    }
    const created = await createProvider(input);
    return NextResponse.json({ code: "00000", message: "ok", data: { provider: created } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "invalid request" },
      { status: 400 }
    );
  }
}
