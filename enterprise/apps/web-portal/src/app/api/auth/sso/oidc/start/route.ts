import { OidcConfigError, buildStateCookieValue } from "@agenticx/auth";
import { NextResponse } from "next/server";
import {
  getOidcClientService,
  getPortalSsoProviderConfigServer,
  resolveReturnToOrDefault,
} from "../../../../../../lib/sso-runtime";

const PORTAL_OIDC_STATE_COOKIE = "agenticx_oidc_state_portal";

function mapStartError(error: unknown): string {
  if (error instanceof OidcConfigError) return error.code;
  if (error instanceof Error && error.message.startsWith("oidc.")) return error.message;
  return "oidc.start_failed";
}

function resolveStateSecret(): string {
  const secret = process.env.SSO_STATE_SIGNING_SECRET?.trim();
  if (!secret) {
    throw new Error("oidc.state_secret_missing");
  }
  return secret;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const providerId = url.searchParams.get("provider")?.trim() || "default";
  const returnTo = resolveReturnToOrDefault(url.searchParams.get("returnTo"));

  try {
    const provider = await getPortalSsoProviderConfigServer(providerId);
    const secret = resolveStateSecret();
    const oidcClient = getOidcClientService();

    const codeVerifier = oidcClient.createCodeVerifier();
    const { cookieValue, state } = buildStateCookieValue(
      {
        providerId,
        returnTo,
        codeVerifier,
      },
      secret
    );

    const authorizationUrl = await oidcClient.buildAuthorizationUrl({
      provider,
      state: state.state,
      nonce: state.nonce,
      codeVerifier: state.codeVerifier,
      returnTo,
    });

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(PORTAL_OIDC_STATE_COOKIE, cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth/sso/oidc",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    return NextResponse.redirect(new URL(`/auth?sso_error=${encodeURIComponent(mapStartError(error))}`, url.origin));
  }
}
