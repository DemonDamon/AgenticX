import { validateStateFromCookie } from "@agenticx/auth";
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
  if (error instanceof Error) {
    if (error.message.startsWith("oidc.")) return error.message;
    if (error.message.includes("state")) return "oidc.invalid_state";
  }
  return "oidc.callback_failed";
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

  try {
    const secret = resolveStateSecret();
    const decoded = validateStateFromCookie(stateCookie, state, secret);
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
      const response = NextResponse.redirect(new URL(`/login?sso_error=${reasonToErrorCode(result.reason)}`, url.origin));
      response.cookies.set(ADMIN_OIDC_STATE_COOKIE, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/api/auth/sso/oidc",
        maxAge: 0,
      });
      return response;
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
