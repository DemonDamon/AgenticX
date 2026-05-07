import { OidcConfigError, buildStateCookieValue } from "@agenticx/auth";
import { NextResponse } from "next/server";
import {
  getOidcClientService,
  getPortalSsoProviderConfigServer,
  getPortalSsoProviderOptions,
  resolveReturnToOrDefault,
} from "../../../../../../lib/sso-runtime";

const PORTAL_OIDC_STATE_COOKIE = "agenticx_oidc_state_portal";

function toOidcErrorCode(error: unknown): string | null {
  if (error instanceof OidcConfigError) return error.code;
  if (error instanceof Error && error.message.startsWith("oidc.")) return error.message;
  return null;
}

function mapStartError(error: unknown): string {
  return toOidcErrorCode(error) ?? "oidc.start_failed";
}

function isUnavailableProviderError(error: unknown): boolean {
  const code = toOidcErrorCode(error);
  return code === "oidc.provider_not_configured" || code === "oidc.provider_disabled";
}

function resolveProviderCandidates(requestedProviderId: string): string[] {
  const ordered = new Set<string>();
  const first = requestedProviderId.trim();
  if (first) ordered.add(first);
  for (const option of getPortalSsoProviderOptions()) {
    const id = option.id.trim();
    if (id) ordered.add(id);
  }
  return Array.from(ordered);
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
  const requestedProviderId = url.searchParams.get("provider")?.trim() || "default";
  const returnTo = resolveReturnToOrDefault(url.searchParams.get("returnTo"));

  try {
    const providerCandidates = resolveProviderCandidates(requestedProviderId);
    let provider = null;
    let selectedProviderId = requestedProviderId;
    let firstError: unknown = null;
    for (const candidateProviderId of providerCandidates) {
      try {
        provider = await getPortalSsoProviderConfigServer(candidateProviderId);
        selectedProviderId = candidateProviderId;
        break;
      } catch (error) {
        if (!firstError) firstError = error;
        if (!isUnavailableProviderError(error)) {
          throw error;
        }
        if (candidateProviderId === requestedProviderId) {
          continue;
        }
      }
    }
    if (!provider) {
      throw firstError ?? new Error("oidc.provider_not_configured");
    }

    const secret = resolveStateSecret();
    const oidcClient = getOidcClientService();

    const codeVerifier = oidcClient.createCodeVerifier();
    const { cookieValue, state } = buildStateCookieValue(
      {
        providerId: selectedProviderId,
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
