import {
  SamlAttributeError,
  SamlCallbackError,
  SamlConfigError,
  createSamlProtocolHandler,
  decodeSignedSamlState,
  DEFAULT_SAML_PORTAL_STATE_COOKIE,
} from "@agenticx/auth";
import { insertAuditEvent, sanitizeSsoAuditDetail } from "@agenticx/iam-core";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { loginWithOidcClaims } from "../../../../../../lib/auth-runtime";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../../../../../../lib/session";
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

function mapCallbackError(error: unknown): string {
  if (error instanceof SamlCallbackError) return error.code;
  if (error instanceof SamlConfigError) return error.code;
  if (error instanceof SamlAttributeError) return error.code;
  if (error instanceof Error) {
    if (error.message.startsWith("saml.")) return error.message;
  }
  return "saml.callback_failed";
}

async function recordPortalSamlLoginFailed(input: {
  reasonCode: string;
  providerId?: string | null;
  emailHint?: string | null;
  subHint?: string | null;
  issuer?: string | null;
}): Promise<void> {
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim();
  if (!tenantId || !process.env.DATABASE_URL?.trim()) return;
  try {
    await insertAuditEvent({
      tenantId,
      actorUserId: null,
      eventType: "auth.sso.login_failed",
      targetKind: "sso_login",
      detail: sanitizeSsoAuditDetail({
        protocol: "saml",
        reason_code: input.reasonCode,
        provider_id: input.providerId ?? null,
        issuer: input.issuer ?? null,
        external_subject: input.subHint ?? null,
        email_hint: input.emailHint ?? null,
      }),
    });
  } catch (err) {
    console.error("[web-portal] auth.sso.login_failed (saml) audit failed:", err);
  }
}

function resolveStateCookiePolicy(): { secure: boolean; sameSite: "none" | "lax" } {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
  };
}

function clearStateCookieOn(response: NextResponse): NextResponse {
  const cookiePolicy = resolveStateCookiePolicy();
  response.cookies.set(PORTAL_SAML_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: cookiePolicy.sameSite,
    secure: cookiePolicy.secure,
    path: "/api/auth/sso/saml",
    maxAge: 0,
  });
  return response;
}

export async function POST(request: Request) {
  const url = new URL(request.url);

  if (isSamlGloballyDisabled()) {
    void recordPortalSamlLoginFailed({ reasonCode: "saml.provider_not_configured" });
    return clearStateCookieOn(
      NextResponse.json({ error: "saml.provider_not_configured" }, { status: 400 })
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    const code = "saml.callback_failed";
    void recordPortalSamlLoginFailed({ reasonCode: code });
    return clearStateCookieOn(
      NextResponse.redirect(new URL(`/auth?sso_error=${encodeURIComponent(code)}`, url.origin))
    );
  }
  const samlResponse = (formData.get("SAMLResponse") ?? "").toString();
  const relayState = (formData.get("RelayState") ?? "").toString();
  if (!samlResponse || !relayState) {
    const code = "saml.callback_failed";
    void recordPortalSamlLoginFailed({ reasonCode: code });
    return clearStateCookieOn(
      NextResponse.redirect(new URL(`/auth?sso_error=${encodeURIComponent(code)}`, url.origin))
    );
  }

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(PORTAL_SAML_STATE_COOKIE)?.value;

  let providerId: string | null = null;
  let issuerForAudit: string | null = null;
  let subjectForAudit: string | null = null;
  let emailForAudit: string | null = null;

  try {
    const secret = resolveStateSecret();
    const handler = createSamlProtocolHandler();

    let preliminaryProviderId: string | null = null;
    if (stateCookie) {
      try {
        const decoded = decodeSignedSamlState(stateCookie, secret);
        preliminaryProviderId = decoded.providerId ?? null;
      } catch (error) {
        if (error instanceof Error && error.message === "saml.relay_state_expired") {
          throw new SamlCallbackError("saml.relay_state_expired", "SAML state cookie expired", { cause: error });
        }
        preliminaryProviderId = null;
      }
    }
    if (!preliminaryProviderId) {
      throw new SamlCallbackError("saml.relay_state_invalid", "Missing or invalid SAML state cookie");
    }
    providerId = preliminaryProviderId;
    const provider = await getPortalSamlProviderConfigServer(preliminaryProviderId);
    issuerForAudit = provider.idpEntityId;

    const result = await handler.handleCallback({
      provider,
      cookieSecret: secret,
      cookieValue: stateCookie ?? null,
      samlResponse,
      relayState,
    });

    subjectForAudit = result.identity.externalSubject ?? null;
    emailForAudit = result.identity.email ?? null;

    const loginResult = await loginWithOidcClaims({
      providerId: provider.providerId,
      issuer: provider.idpEntityId,
      subject: result.identity.externalSubject,
      email: result.identity.email,
      displayName: result.identity.displayName ?? result.identity.email,
      deptHint: result.identity.deptHint,
      roleCodeHints: result.identity.roleCodeHints,
      protocol: "saml",
    });

    const returnTo = resolveReturnToOrDefault(result.state.returnTo ?? "/workspace");
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
    return clearStateCookieOn(response);
  } catch (error) {
    const code = mapCallbackError(error);
    void recordPortalSamlLoginFailed({
      reasonCode: code,
      providerId,
      issuer: issuerForAudit,
      subHint: subjectForAudit,
      emailHint: emailForAudit,
    });
    return clearStateCookieOn(
      NextResponse.redirect(new URL(`/auth?sso_error=${encodeURIComponent(code)}`, url.origin))
    );
  }
}
