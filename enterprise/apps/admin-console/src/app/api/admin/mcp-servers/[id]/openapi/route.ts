import { NextResponse } from "next/server";
import { importOpenAPITools } from "../../../../../../lib/mcp-servers-store";
import { requireAdminScope } from "../../../../../../lib/admin-auth";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const body = (await request.json()) as {
      spec?: string;
      allowedOperationIds?: string[];
      baseUrl?: string;
    };
    if (!body.spec?.trim()) {
      return NextResponse.json({ code: "40000", message: "spec required" }, { status: 400 });
    }
    const server = await importOpenAPITools(
      id,
      body.spec,
      body.allowedOperationIds ?? [],
      body.baseUrl
    );
    return NextResponse.json({ code: "00000", message: "ok", data: { server } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "import failed" },
      { status: 400 }
    );
  }
}
