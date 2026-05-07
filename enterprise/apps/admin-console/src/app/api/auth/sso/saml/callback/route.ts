import {
  SamlAttributeError,
  SamlCallbackError,
  SamlConfigError,
  createSamlProtocolHandler,
  decodeSignedSamlState,
  DEFAULT_SAML_ADMIN_STATE_COOKIE,
} from "@agenticx/auth";
import { insertAuditEvent, sanitizeSsoAuditDetail } from "@agenticx/iam-core";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authenticateAdminConsoleViaOidc } from "../../../../../../lib/admin-pg-auth";
import { ADMIN_SESSION_COOKIE, createAdminSessionToken } from "../../../../../../lib/admin-session";
import { getAdminSamlProviderConfigServer } from "../../../../../../lib/admin-sso-runtime";

const ADMIN_SAML_STATE_COOKIE = DEFAULT_SAML_ADMIN_STATE_COOKIE;

function isSamlGloballyDisabled(): boolean {
  return process.env.SSO_SAML_DISABLED?.trim().toLowerCase() === "true";
}

function getDefaultTenantId(): string | null {
  return process.env.DEFAULT_TENANT_ID?.trim() || null;
}

function resolveStateSecret(): string {
  const secret = process.env.SSO_STATE_SIGNING_SECRET?.trim();
  if (!secret) throw new Error("saml.state_secret_missing");
  return secret;
}

function reasonToErrorCode(reason: "admin_unprovisioned" | "admin_scope_missing" | "account_disabled"): string {
  if (reason === "admin_scope_missing") return "admin_scope_missing";
  if (reason === "account_disabled") return "account_disabled";
  return "admin_unprovisioned";
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

async function recordAdminSamlLoginFailed(input: {
  tenantId: string;
  reasonCode: string;
  providerId?: string | null;
  emailHint?: string | null;
  issuer?: string | null;
  subHint?: string | null;
}): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) return;
  try {
    await insertAuditEvent({
      tenantId: input.tenantId,
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
    console.error("[admin-console] auth.sso.login_failed (saml) audit failed:", err);
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
  response.cookies.set(ADMIN_SAML_STATE_COOKIE, "", {
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
  const tenantId = getDefaultTenantId();
  if (!tenantId) {
    return NextResponse.redirect(new URL("/login?sso_error=tenant_missing", url.origin));
  }

  if (isSamlGloballyDisabled()) {
    void recordAdminSamlLoginFailed({ tenantId, reasonCode: "saml.provider_not_configured" });
    return clearStateCookieOn(
      NextResponse.json({ error: "saml.provider_not_configured" }, { status: 400 })
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    const code = "saml.callback_failed";
    void recordAdminSamlLoginFailed({ tenantId, reasonCode: code });
    return clearStateCookieOn(
      NextResponse.redirect(new URL(`/login?sso_error=${encodeURIComponent(code)}`, url.origin))
    );
  }
  const samlResponse = (formData.get("SAMLResponse") ?? "").toString();
  const relayState = (formData.get("RelayState") ?? "").toString();
  if (!samlResponse || !relayState) {
    const code = "saml.callback_failed";
    void recordAdminSamlLoginFailed({ tenantId, reasonCode: code });
    return clearStateCookieOn(
      NextResponse.redirect(new URL(`/login?sso_error=${encodeURIComponent(code)}`, url.origin))
    );
  }

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(ADMIN_SAML_STATE_COOKIE)?.value;

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
    const provider = await getAdminSamlProviderConfigServer(preliminaryProviderId);
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

    const policy = await authenticateAdminConsoleViaOidc({
      email: result.identity.email,
      tenantId,
    });
    if (!policy.ok) {
      const errCode = reasonToErrorCode(policy.reason);
      void recordAdminSamlLoginFailed({
        tenantId,
        reasonCode: errCode,
        providerId,
        emailHint: emailForAudit,
        issuer: issuerForAudit,
        subHint: subjectForAudit,
      });
      return clearStateCookieOn(
        NextResponse.redirect(new URL(`/login?sso_error=${errCode}`, url.origin))
      );
    }

    if (process.env.DATABASE_URL?.trim()) {
      try {
        await insertAuditEvent({
          tenantId,
          actorUserId: policy.userId,
          eventType: "auth.sso.admin_login",
          targetKind: "user",
          targetId: policy.userId,
          detail: sanitizeSsoAuditDetail({
            protocol: "saml",
            provider: providerId,
            provider_id: providerId,
            issuer: issuerForAudit,
            external_subject: subjectForAudit,
            email: policy.email,
          }),
        });
      } catch (err) {
        console.error("[admin-console] auth.sso.admin_login (saml) audit failed:", err);
      }
    }

    const token = createAdminSessionToken(policy.email, policy.userId, policy.tenantId);
    const response = NextResponse.redirect(new URL("/dashboard", url.origin));
    response.cookies.set(ADMIN_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    return clearStateCookieOn(response);
  } catch (error) {
    const code = mapCallbackError(error);
    void recordAdminSamlLoginFailed({
      tenantId,
      reasonCode: code,
      providerId,
      emailHint: emailForAudit,
      issuer: issuerForAudit,
      subHint: subjectForAudit,
    });
    return clearStateCookieOn(
      NextResponse.redirect(new URL(`/login?sso_error=${encodeURIComponent(code)}`, url.origin))
    );
  }
}
