import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { getProviderInternal } from "../../../../../../lib/model-providers-store";

/** admin 专用：读取已落库的明文 API Key，供设置页「显示密钥」使用。 */
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const provider = await getProviderInternal(id);
  if (!provider) {
    return NextResponse.json({ code: "40400", message: "provider not found" }, { status: 404 });
  }

  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { apiKey: provider.apiKey },
  });
}
