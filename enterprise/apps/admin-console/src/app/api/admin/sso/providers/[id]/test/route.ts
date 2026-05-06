import { OidcClientService } from "@agenticx/auth";
import { decryptSecret } from "@agenticx/auth";
import { getSsoProviderById } from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../../lib/admin-auth";
import { assertSafeIssuerUrl } from "../../../../../../../lib/sso-url-guard";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteParams) {
  const guard = await requireAdminScope(["sso:manage"]);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const provider = await getSsoProviderById(guard.session.tenantId, id);
  if (!provider) {
    return NextResponse.json({ code: "40400", message: "provider not found" }, { status: 404 });
  }

  try {
    await assertSafeIssuerUrl(provider.issuer);
    const service = new OidcClientService();
    const secretKey = process.env.SSO_PROVIDER_SECRET_KEY?.trim();
    await service.getConfiguration({
      providerId: provider.providerId,
      issuer: provider.issuer,
      clientId: provider.clientId,
      clientSecret:
        provider.clientSecretEncrypted && secretKey
          ? decryptSecret(provider.clientSecretEncrypted, secretKey)
          : undefined,
      redirectUri: provider.redirectUri,
      scopes: provider.scopes,
      claimMapping: {
        email: `${provider.claimMapping.email ?? "email"}`,
      },
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { reachable: true } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("issuer_")) {
      return NextResponse.json({ code: "40000", message: `SSO 配置不合法: ${error.message}` }, { status: 400 });
    }
    console.error("[admin-sso] provider discover failed:", error);
    return NextResponse.json({ code: "50000", message: "SSO provider discover failed" }, { status: 500 });
  }
}
