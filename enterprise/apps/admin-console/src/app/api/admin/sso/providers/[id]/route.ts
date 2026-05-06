import { encryptSecret } from "@agenticx/auth";
import { deleteSsoProvider, updateSsoProvider } from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { getOidcClientService } from "../../../../../../lib/admin-sso-runtime";
import { assertSafeIssuerUrl, assertValidRedirectUri } from "../../../../../../lib/sso-url-guard";

type RouteParams = {
  params: Promise<{ id: string }>;
};

function resolveSecretKey(): string {
  const secret = process.env.SSO_PROVIDER_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error("SSO_PROVIDER_SECRET_KEY is required");
  }
  return secret;
}

function normalizeArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => `${item}`.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return undefined;
}

export async function PATCH(request: Request, context: RouteParams) {
  const guard = await requireAdminScope(["sso:manage"]);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const issuer = body.issuer !== undefined ? `${body.issuer ?? ""}`.trim() : undefined;
  const redirectUri = body.redirectUri !== undefined ? `${body.redirectUri ?? ""}`.trim() : undefined;

  try {
    if (issuer !== undefined) {
      await assertSafeIssuerUrl(issuer);
    }
    if (redirectUri !== undefined) {
      assertValidRedirectUri(redirectUri);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_sso_url";
    return NextResponse.json({ code: "40000", message: `SSO 配置不合法: ${message}` }, { status: 400 });
  }

  try {
    const clientSecret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : undefined;
    const provider = await updateSsoProvider(
      guard.session.tenantId,
      id,
      {
        ...(body.displayName !== undefined ? { displayName: `${body.displayName ?? ""}`.trim() } : {}),
        ...(issuer !== undefined ? { issuer } : {}),
        ...(body.clientId !== undefined ? { clientId: `${body.clientId ?? ""}`.trim() } : {}),
        ...(redirectUri !== undefined ? { redirectUri } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled === true } : {}),
        ...(body.scopes !== undefined ? { scopes: normalizeArray(body.scopes) ?? ["openid", "profile", "email"] } : {}),
        ...(body.claimMapping !== undefined ? { claimMapping: (body.claimMapping as Record<string, unknown>) ?? {} } : {}),
        ...(body.defaultRoleCodes !== undefined
          ? { defaultRoleCodes: normalizeArray(body.defaultRoleCodes) ?? ["member"] }
          : {}),
        ...(clientSecret !== undefined
          ? {
              clientSecretEncrypted: clientSecret
                ? encryptSecret(clientSecret, resolveSecretKey())
                : null,
            }
          : {}),
      },
      guard.session.userId
    );
    if (!provider) {
      return NextResponse.json({ code: "40400", message: "provider not found" }, { status: 404 });
    }
    try {
      getOidcClientService().invalidateProvider(provider.providerId);
    } catch (cacheError) {
      console.warn("[admin-sso] invalidate discovery cache failed:", cacheError);
    }
    return NextResponse.json({ code: "00000", message: "ok", data: { provider } });
  } catch (error) {
    console.error("[admin-sso] update provider failed:", error);
    return NextResponse.json({ code: "50000", message: "更新 SSO Provider 失败" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteParams) {
  const guard = await requireAdminScope(["sso:manage"]);
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  try {
    const removed = await deleteSsoProvider(guard.session.tenantId, id, guard.session.userId);
    if (removed) {
      try {
        getOidcClientService().invalidateProvider(removed.providerId);
      } catch (cacheError) {
        console.warn("[admin-sso] invalidate discovery cache failed:", cacheError);
      }
    }
    return NextResponse.json({ code: "00000", message: "ok" });
  } catch (error) {
    console.error("[admin-sso] delete provider failed:", error);
    return NextResponse.json({ code: "50000", message: "删除 SSO Provider 失败" }, { status: 500 });
  }
}
