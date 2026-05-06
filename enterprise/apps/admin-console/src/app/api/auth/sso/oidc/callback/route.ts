import { OidcCallbackError, OidcClaimError, OidcConfigError, validateStateFromCookie } from "@agenticx/auth";
import { insertAuditEvent, sanitizeSsoAuditDetail } from "@agenticx/iam-core";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authenticateAdminConsoleViaOidc } from "../../../../../../lib/admin-pg-auth";
import { ADMIN_SESSION_COOKIE, createAdminSessionToken } from "../../../../../../lib/admin-session";
import {
  getAdminSsoProviderConfigServer,
  getOidcClientService,
} from "../../../../../../lib/admin-sso-runtime";

const ADMIN_OIDC_STATE_COOKIE = "agenticx_oidc_state_admin";

function getDefaultTenantId(): string | null {
  return process.env.DEFAULT_TENANT_ID?.trim() || null;
}

function resolveStateSecret(): string {
  const secret = process.env.SSO_STATE_SIGNING_SECRET?.trim();
  if (!secret) throw new Error("oidc.state_secret_missing");
  return secret;
}

function reasonToErrorCode(reason: "admin_unprovisioned" | "admin_scope_missing" | "account_disabled"): string {
  if (reason === "admin_scope_missing") return "admin_scope_missing";
  if (reason === "account_disabled") return "account_disabled";
  return "admin_unprovisioned";
}

function mapCallbackError(error: unknown): string {
  if (error instanceof OidcCallbackError) return error.code;
  if (error instanceof OidcClaimError) return error.code;
  if (error instanceof OidcConfigError) return error.code;
  if (error instanceof Error) {
    if (error.message.startsWith("oidc.")) return error.message;
    if (error.message.includes("state")) return "oidc.invalid_state";
  }
  return "oidc.callback_failed";
}

async function recordAdminSsoLoginFailed(input: {
  tenantId: string;
  reasonCode: string;
  providerId?: string | null;
  emailHint?: string | null;
}): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) return;
  try {
    await insertAuditEvent({
      tenantId: input.tenantId,
      actorUserId: null,
      eventType: "auth.sso.login_failed",
      targetKind: "sso_login",
      detail: sanitizeSsoAuditDetail({
        reason_code: input.reasonCode,
        provider_id: input.providerId ?? null,
        email_hint: input.emailHint ?? null,
      }),
    });
  } catch (err) {
    console.error("[admin-console] auth.sso.login_failed audit failed:", err);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const tenantId = getDefaultTenantId();
  if (!tenantId) {
    return NextResponse.redirect(new URL("/login?sso_error=tenant_missing", url.origin));
  }
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(ADMIN_OIDC_STATE_COOKIE)?.value;

  let providerId: string | null = null;

  try {
    const secret = resolveStateSecret();
    const decoded = validateStateFromCookie(stateCookie, state, secret);
    providerId = decoded.providerId;
    const provider = await getAdminSsoProviderConfigServer(decoded.providerId);
    const oidcClient = getOidcClientService();
    const exchanged = await oidcClient.exchangeCallback({
      provider,
      callbackUrl: request.url,
      expectedState: decoded.state,
      expectedNonce: decoded.nonce,
      codeVerifier: decoded.codeVerifier,
    });

    const result = await authenticateAdminConsoleViaOidc({
      email: exchanged.mapped.email,
      tenantId,
    });
    if (!result.ok) {
      const errCode = reasonToErrorCode(result.reason);
      void recordAdminSsoLoginFailed({
        tenantId,
        reasonCode: errCode,
        providerId,
        emailHint: exchanged.mapped.email,
      });
      const response = NextResponse.redirect(new URL(`/login?sso_error=${errCode}`, url.origin));
      response.cookies.set(ADMIN_OIDC_STATE_COOKIE, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/api/auth/sso/oidc",
        maxAge: 0,
      });
      return response;
    }

    if (process.env.DATABASE_URL?.trim()) {
      try {
        await insertAuditEvent({
          tenantId,
          actorUserId: result.userId,
          eventType: "auth.sso.admin_login",
          targetKind: "user",
          targetId: result.userId,
          detail: sanitizeSsoAuditDetail({
            provider: providerId,
            issuer: provider.issuer,
            email: result.email,
          }),
        });
      } catch (err) {
        console.error("[admin-console] auth.sso.admin_login audit failed:", err);
      }
    }

    const token = createAdminSessionToken(result.email, result.userId, result.tenantId);
    const response = NextResponse.redirect(new URL("/dashboard", url.origin));
    response.cookies.set(ADMIN_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    response.cookies.set(ADMIN_OIDC_STATE_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth/sso/oidc",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    const code = mapCallbackError(error);
    void recordAdminSsoLoginFailed({ tenantId, reasonCode: code, providerId });
    const response = NextResponse.redirect(new URL(`/login?sso_error=${encodeURIComponent(code)}`, url.origin));
    response.cookies.set(ADMIN_OIDC_STATE_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth/sso/oidc",
      maxAge: 0,
    });
    return response;
  }
}
