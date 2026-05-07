import { encryptSecret } from "@agenticx/auth";
import {
  createSsoProvider,
  listSsoProviders,
  type SsoProviderProtocol,
  type SsoProviderSamlConfig,
} from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { assertSafeIssuerUrl, assertSafeRedirectUri } from "../../../../../lib/sso-url-guard";
import {
  assertSafeSamlConfigUrls,
  parseSamlConfigPayload,
  SamlConfigPayloadError,
  samlConfigErrorResponse,
} from "../../../../../lib/sso-saml-config";

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

function normalizeArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const parsed = value.map((item) => `${item}`.trim()).filter(Boolean);
    return parsed.length ? parsed : fallback;
  }
  if (typeof value === "string") {
    const parsed = value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    return parsed.length ? parsed : fallback;
  }
  return fallback;
}

function isConflictError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

export async function GET() {
  const guard = await requireAdminScope(["sso:read"]);
  if (!guard.ok) return guard.response;
  const providers = (await listSsoProviders(guard.session.tenantId)).map((item) => ({
    ...item,
    clientSecretEncrypted: null,
    hasClientSecret: Boolean(item.clientSecretEncrypted),
  }));
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: {
      providers,
      samlGloballyDisabled: isSamlGloballyDisabled(),
    },
  });
}

function isSamlGloballyDisabled(): boolean {
  return process.env.SSO_SAML_DISABLED?.trim().toLowerCase() === "true";
}

export async function POST(request: Request) {
  const guard = await requireAdminScope(["sso:manage"]);
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const providerId = `${body.providerId ?? ""}`.trim();
  const displayName = `${body.displayName ?? ""}`.trim();
  const protocol: SsoProviderProtocol = body.protocol === "saml" ? "saml" : "oidc";

  if (!providerId || !displayName) {
    return NextResponse.json({ code: "40000", message: "providerId/displayName 为必填项" }, { status: 400 });
  }
  if (!/^[a-z0-9_-]{1,64}$/i.test(providerId)) {
    return NextResponse.json({ code: "40000", message: "providerId 仅允许字母、数字、下划线和中划线，长度不超过 64" }, { status: 400 });
  }

  if (protocol === "saml" && isSamlGloballyDisabled()) {
    return NextResponse.json({ code: "40000", message: "当前 SAML 已被一键回退，禁止新建 SAML Provider" }, { status: 400 });
  }

  if (protocol === "oidc") {
    const issuer = `${body.issuer ?? ""}`.trim();
    const clientId = `${body.clientId ?? ""}`.trim();
    const redirectUri = `${body.redirectUri ?? ""}`.trim();
    const clientSecret = `${body.clientSecret ?? ""}`.trim();
    if (!issuer || !clientId || !redirectUri) {
      return NextResponse.json({ code: "40000", message: "issuer/clientId/redirectUri 为 OIDC 必填项" }, { status: 400 });
    }
    try {
      await assertSafeIssuerUrl(issuer);
      await assertSafeRedirectUri(redirectUri, { issuerUrl: issuer });
    } catch (error) {
      return badSsoConfigResponse(error);
    }
    try {
      const encrypted = clientSecret ? encryptSecret(clientSecret, resolveSecretKey()) : null;
      const provider = await createSsoProvider({
        tenantId: guard.session.tenantId,
        actorUserId: guard.session.userId,
        providerId,
        displayName,
        protocol: "oidc",
        issuer,
        clientId,
        clientSecretEncrypted: encrypted,
        redirectUri,
        scopes: normalizeArray(body.scopes, ["openid", "profile", "email"]),
        claimMapping: (body.claimMapping as Record<string, unknown>) ?? {},
        defaultRoleCodes: normalizeArray(body.defaultRoleCodes, ["member"]),
        enabled: body.enabled === true,
      });
      return NextResponse.json({ code: "00000", message: "ok", data: { provider } });
    } catch (error) {
      if (isConflictError(error)) {
        return NextResponse.json({ code: "40900", message: "providerId 已存在" }, { status: 409 });
      }
      console.error("[admin-sso] create OIDC provider failed:", error);
      return NextResponse.json({ code: "50000", message: "创建 SSO Provider 失败" }, { status: 500 });
    }
  }

  let samlConfig: SsoProviderSamlConfig;
  try {
    samlConfig = parseSamlConfigPayload(body.samlConfig);
    await assertSafeSamlConfigUrls(samlConfig);
  } catch (error) {
    if (error instanceof SamlConfigPayloadError) {
      return samlConfigErrorResponse(error);
    }
    return badSsoConfigResponse(error);
  }

  try {
    const provider = await createSsoProvider({
      tenantId: guard.session.tenantId,
      actorUserId: guard.session.userId,
      providerId,
      displayName,
      protocol: "saml",
      samlConfig,
      defaultRoleCodes: normalizeArray(body.defaultRoleCodes, ["member"]),
      enabled: body.enabled === true,
      claimMapping: (body.claimMapping as Record<string, unknown>) ?? {},
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { provider } });
  } catch (error) {
    if (isConflictError(error)) {
      return NextResponse.json({ code: "40900", message: "providerId 已存在" }, { status: 409 });
    }
    console.error("[admin-sso] create SAML provider failed:", error);
    return NextResponse.json({ code: "50000", message: "创建 SSO Provider 失败" }, { status: 500 });
  }
}
