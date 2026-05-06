import { validateStateFromCookie } from "@agenticx/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { loginWithOidcClaims } from "../../../../../../lib/auth-runtime";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../../../../../../lib/session";
import {
  getOidcClientService,
  getPortalSsoProviderConfigServer,
  resolveReturnToOrDefault,
} from "../../../../../../lib/sso-runtime";

const PORTAL_OIDC_STATE_COOKIE = "agenticx_oidc_state_portal";

function resolveStateSecret(): string {
  const secret = process.env.SSO_STATE_SIGNING_SECRET?.trim();
  if (!secret) {
    throw new Error("oidc.state_secret_missing");
  }
  return secret;
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
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(PORTAL_OIDC_STATE_COOKIE)?.value;

  try {
    const secret = resolveStateSecret();
    const decoded = validateStateFromCookie(stateCookie, state, secret);
    const provider = await getPortalSsoProviderConfigServer(decoded.providerId);
    const oidcClient = getOidcClientService();
    const exchanged = await oidcClient.exchangeCallback({
      provider,
      callbackUrl: request.url,
      expectedState: decoded.state,
      expectedNonce: decoded.nonce,
      codeVerifier: decoded.codeVerifier,
    });

    const loginResult = await loginWithOidcClaims({
      providerId: provider.providerId,
      issuer: provider.issuer,
      subject: exchanged.mapped.externalId,
      email: exchanged.mapped.email,
      displayName: exchanged.mapped.displayName,
      deptHint: exchanged.mapped.deptHint,
      roleCodeHints: exchanged.mapped.roleCodeHints,
    });

    const returnTo = resolveReturnToOrDefault(decoded.returnTo ?? "/workspace");
    const response = NextResponse.redirect(new URL(returnTo, url.origin));
    response.cookies.set(ACCESS_COOKIE, loginResult.tokens.accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: loginResult.tokens.expiresInSeconds,
      path: "/",
    });
    response.cookies.set(REFRESH_COOKIE, loginResult.tokens.refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });
    response.cookies.set(PORTAL_OIDC_STATE_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth/sso/oidc",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    const code = mapCallbackError(error);
    const response = NextResponse.redirect(new URL(`/auth?sso_error=${encodeURIComponent(code)}`, url.origin));
    response.cookies.set(PORTAL_OIDC_STATE_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth/sso/oidc",
      maxAge: 0,
    });
    return response;
  }
}
