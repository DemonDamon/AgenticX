import { encryptSecret } from "@agenticx/auth";
import {
  deleteSsoProvider,
  getSsoProviderById,
  updateSsoProvider,
  type SsoProviderSamlConfig,
} from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { getOidcClientService } from "../../../../../../lib/admin-sso-runtime";
import {
  assertSafeSamlConfigUrls,
  parseSamlConfigPayload,
  SamlConfigPayloadError,
  samlConfigErrorResponse,
} from "../../../../../../lib/sso-saml-config";
import {
  assertSafeIssuerUrl,
  assertSafeRedirectUri,
  invalidateIssuerDnsCacheForHost,
} from "../../../../../../lib/sso-url-guard";

type RouteParams = {
  params: Promise<{ id: string }>;
};

function isSamlGloballyDisabled(): boolean {
  return process.env.SSO_SAML_DISABLED?.trim().toLowerCase() === "true";
}

function badSsoConfigResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "invalid_sso_url";
  const redirectIssue =
    message.includes("redirect_uri") ||
    message === "redirect_uri_https_required" ||
    message === "redirect_uri_http_not_allowed" ||
    message === "redirect_uri_origin_not_in_allowlist" ||
    message === "redirect_uri_issuer_origin_mismatch";
  return NextResponse.json(
    {
      code: "40000",
      message: `SSO 配置不合法: ${message}`,
      ...(redirectIssue ? { ssoError: "oidc.invalid_redirect_uri" as const } : {}),
    },
    { status: 400 }
  );
}

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
  const existing = await getSsoProviderById(guard.session.tenantId, id);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const requestedProtocol =
    typeof body.protocol === "string" && body.protocol.trim() ? body.protocol.trim() : undefined;
  if (requestedProtocol && existing?.protocol && requestedProtocol !== existing.protocol) {
    return NextResponse.json(
      { code: "40000", message: "protocol cannot be changed" },
      { status: 400 }
    );
  }
  if (isSamlGloballyDisabled() && existing?.protocol === "saml" && body.enabled === true) {
    return NextResponse.json(
      { code: "40000", message: "当前 SAML 已被一键回退，禁止启用 SAML Provider" },
      { status: 400 }
    );
  }
  if (existing?.protocol === "oidc") {
    const oidcRequiredFields = ["issuer", "clientId", "redirectUri"] as const;
    for (const field of oidcRequiredFields) {
      if (typeof body[field] === "string" && body[field].trim() === "") {
        return NextResponse.json(
          { code: "40000", message: `OIDC 字段 ${field} 不能为空` },
          { status: 400 }
        );
      }
    }
  }
  const issuer = body.issuer !== undefined ? `${body.issuer ?? ""}`.trim() : undefined;
  const redirectUri = body.redirectUri !== undefined ? `${body.redirectUri ?? ""}`.trim() : undefined;

  try {
    if (issuer !== undefined) {
      if (existing?.issuer) {
        try {
          invalidateIssuerDnsCacheForHost(new URL(existing.issuer).hostname);
        } catch {
          /* ignore invalid old issuer */
        }
      }
      await assertSafeIssuerUrl(issuer);
      try {
        invalidateIssuerDnsCacheForHost(new URL(issuer).hostname);
      } catch {
        /* ignore */
      }
    }
    const issuerForRedirect = issuer ?? existing?.issuer ?? undefined;
    if (redirectUri !== undefined) {
      await assertSafeRedirectUri(redirectUri, { issuerUrl: issuerForRedirect ?? undefined });
    }
  } catch (error) {
    return badSsoConfigResponse(error);
  }

  let samlConfigPatch: SsoProviderSamlConfig | undefined;
  if (body.samlConfig !== undefined) {
    try {
      samlConfigPatch = parseSamlConfigPayload(body.samlConfig);
      await assertSafeSamlConfigUrls(samlConfigPatch);
    } catch (error) {
      if (error instanceof SamlConfigPayloadError) {
        return samlConfigErrorResponse(error);
      }
      return badSsoConfigResponse(error);
    }
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
        ...(samlConfigPatch !== undefined ? { samlConfig: samlConfigPatch } : {}),
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
