import { SamlCallbackError, SamlConfigError, createSamlProtocolHandler, DEFAULT_SAML_PORTAL_STATE_COOKIE } from "@agenticx/auth";
import { NextResponse } from "next/server";
import {
  getPortalSamlProviderConfigServer,
  resolveReturnToOrDefault,
} from "../../../../../../lib/sso-runtime";

const PORTAL_SAML_STATE_COOKIE = DEFAULT_SAML_PORTAL_STATE_COOKIE;

function isSamlGloballyDisabled(): boolean {
  return process.env.SSO_SAML_DISABLED?.trim().toLowerCase() === "true";
}

function resolveStateSecret(): string {
  const secret = process.env.SSO_STATE_SIGNING_SECRET?.trim();
  if (!secret) {
    throw new Error("saml.state_secret_missing");
  }
  return secret;
}

function mapStartError(error: unknown): string {
  if (error instanceof SamlConfigError) return error.code;
  if (error instanceof SamlCallbackError) return error.code;
  if (error instanceof Error && error.message.startsWith("saml.")) return error.message;
  return "saml.start_failed";
}

function resolveStateCookiePolicy(): { secure: boolean; sameSite: "none" | "lax" } {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const providerId = url.searchParams.get("provider")?.trim() || "default";
  const returnTo = resolveReturnToOrDefault(url.searchParams.get("returnTo"));

  if (isSamlGloballyDisabled()) {
    return NextResponse.redirect(
      new URL(`/auth?sso_error=${encodeURIComponent("saml.provider_not_configured")}`, url.origin)
    );
  }

  try {
    const provider = await getPortalSamlProviderConfigServer(providerId);
    const secret = resolveStateSecret();
    const handler = createSamlProtocolHandler();
    const result = await handler.startAuthentication({
      provider,
      cookieSecret: secret,
      cookieName: PORTAL_SAML_STATE_COOKIE,
      returnTo,
    });
    if (result.kind !== "redirect") {
      throw new SamlCallbackError("saml.callback_failed", "Unexpected SAML start binding.");
    }
    const response = NextResponse.redirect(result.redirectUrl);
    if (result.cookie) {
      const cookiePolicy = resolveStateCookiePolicy();
      response.cookies.set(result.cookie.name, result.cookie.value, {
        httpOnly: true,
        secure: cookiePolicy.secure,
        sameSite: cookiePolicy.sameSite,
        path: "/api/auth/sso/saml",
        maxAge: result.cookie.maxAgeSeconds,
      });
    }
    return response;
  } catch (error) {
    return NextResponse.redirect(new URL(`/auth?sso_error=${encodeURIComponent(mapStartError(error))}`, url.origin));
  }
}
