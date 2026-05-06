import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { getOidcClientService } from "../../../../../../lib/admin-sso-runtime";

/**
 * GET /api/admin/sso/providers/stats — surface OIDC discovery cache stats per provider (FR-B2.2).
 * Requires sso:read so the SSO settings UI can render hit-rate trend without leaking config.
 */
export async function GET() {
  const guard = await requireAdminScope(["sso:read"]);
  if (!guard.ok) return guard.response;

  const stats = getOidcClientService().getOidcCacheStats();
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: stats,
  });
}
