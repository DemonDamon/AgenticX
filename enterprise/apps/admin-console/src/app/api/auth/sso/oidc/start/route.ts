import { OidcConfigError, buildStateCookieValue } from "@agenticx/auth";
import { NextResponse } from "next/server";
import {
  getAdminSsoProviderConfigServer,
  getAdminSsoProviderOptions,
  getOidcClientService,
} from "../../../../../../lib/admin-sso-runtime";

const ADMIN_OIDC_STATE_COOKIE = "agenticx_oidc_state_admin";

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
  for (const option of getAdminSsoProviderOptions()) {
    const id = option.id.trim();
    if (id) ordered.add(id);
  }
  return Array.from(ordered);
}

function resolveStateSecret(): string {
  const secret = process.env.SSO_STATE_SIGNING_SECRET?.trim();
  if (!secret) throw new Error("oidc.state_secret_missing");
  return secret;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedProviderId = url.searchParams.get("provider")?.trim() || "default";
  try {
    const providerCandidates = resolveProviderCandidates(requestedProviderId);
    let provider = null;
    let selectedProviderId = requestedProviderId;
    let firstError: unknown = null;
    for (const candidateProviderId of providerCandidates) {
      try {
        provider = await getAdminSsoProviderConfigServer(candidateProviderId);
        selectedProviderId = candidateProviderId;
        break;
      } catch (error) {
        if (!firstError) firstError = error;
        if (!isUnavailableProviderError(error)) {
          throw error;
        }
      }
    }
    if (!provider) {
      throw firstError ?? new Error("oidc.provider_not_configured");
    }

    const oidcClient = getOidcClientService();
    const secret = resolveStateSecret();
    const codeVerifier = oidcClient.createCodeVerifier();
    const { cookieValue, state } = buildStateCookieValue(
      {
        providerId: selectedProviderId,
        returnTo: "/dashboard",
        codeVerifier,
      },
      secret
    );
    const authorizationUrl = await oidcClient.buildAuthorizationUrl({
      provider,
      state: state.state,
      nonce: state.nonce,
      codeVerifier: state.codeVerifier,
      returnTo: "/dashboard",
    });
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(ADMIN_OIDC_STATE_COOKIE, cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth/sso/oidc",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    return NextResponse.redirect(new URL(`/login?sso_error=${encodeURIComponent(mapStartError(error))}`, url.origin));
  }
}
