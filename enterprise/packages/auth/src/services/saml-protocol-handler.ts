import { SAML, ValidateInResponseTo, type SamlConfig } from "@node-saml/node-saml";
import { inflateRawSync } from "node:zlib";
import { mapSamlProfileToIdentity, SamlAttributeError, type SamlAttributeMapping } from "./saml-attribute-mapper";
import {
  buildSamlStateCookieValue,
  validateSamlStateFromCookie,
  type SamlStatePayload,
} from "./saml-state";
import type {
  SsoCallbackResult,
  SsoExternalIdentity,
  SsoProtocolHandler,
  SsoStartResult,
} from "./sso-protocol-handler";

export class SamlConfigError extends Error {
  public readonly code: string;
  public constructor(code: string, message?: string, options?: { cause?: unknown }) {
    super(message ?? code);
    this.name = "SamlConfigError";
    this.code = code;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export class SamlCallbackError extends Error {
  public readonly code: string;
  public constructor(code: string, message?: string, options?: { cause?: unknown }) {
    super(message ?? code);
    this.name = "SamlCallbackError";
    this.code = code;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export type SamlSpProviderConfig = {
  providerId: string;
  idpEntityId: string;
  idpSsoUrl: string;
  idpSloUrl?: string | null;
  idpCertPemList: string[];
  spEntityId: string;
  acsUrl: string;
  nameIdFormat?: string | null;
  wantAssertionsSigned: boolean;
  wantResponseSigned: boolean;
  clockSkewSeconds: number;
  attributeMapping: SamlAttributeMapping;
  authnRequestBinding?: "HTTP-Redirect" | "HTTP-POST";
};

export type SamlStartHandlerInput = {
  provider: SamlSpProviderConfig;
  cookieSecret: string;
  cookieName: string;
  returnTo?: string;
  ttlMs?: number;
};

export type SamlCallbackHandlerInput = {
  provider: SamlSpProviderConfig;
  cookieSecret: string;
  cookieValue: string | undefined | null;
  samlResponse: string;
  relayState: string;
};

export type SamlStartHandlerResult = Extract<SsoStartResult, { kind: "redirect" }> & {
  state: SamlStatePayload;
};

export type SamlCallbackHandlerResult = SsoCallbackResult & {
  state: SamlStatePayload;
};

/**
 * 把 IdP 证书数组裁掉 PEM 头尾、合并为 node-saml 接受的字符串数组。
 */
function normalizeIdpCert(idpCertPemList: string[]): string[] {
  const cleaned = idpCertPemList
    .map((pem) => pem?.trim())
    .filter((pem): pem is string => Boolean(pem));
  if (cleaned.length === 0) {
    throw new SamlConfigError("saml.provider_not_configured", "Missing IdP certificates");
  }
  return cleaned;
}

function buildSamlInstance(provider: SamlSpProviderConfig): SAML {
  if (!provider.idpEntityId || !provider.idpSsoUrl || !provider.spEntityId || !provider.acsUrl) {
    throw new SamlConfigError("saml.provider_not_configured", "SAML provider missing required endpoints");
  }
  const config: SamlConfig = {
    idpCert: normalizeIdpCert(provider.idpCertPemList),
    issuer: provider.spEntityId,
    callbackUrl: provider.acsUrl,
    entryPoint: provider.idpSsoUrl,
    audience: provider.spEntityId,
    wantAssertionsSigned: provider.wantAssertionsSigned !== false,
    wantAuthnResponseSigned: provider.wantResponseSigned === true,
    acceptedClockSkewMs: Math.max(0, provider.clockSkewSeconds * 1000),
    identifierFormat: provider.nameIdFormat ?? null,
    idpIssuer: provider.idpEntityId,
    validateInResponseTo: ValidateInResponseTo.never,
    disableRequestedAuthnContext: true,
    authnRequestBinding: provider.authnRequestBinding ?? "HTTP-Redirect",
  };
  return new SAML(config);
}

function decodeBase64XmlPayload(payload: string): string | null {
  if (!payload) return null;
  try {
    const raw = Buffer.from(payload.replace(/ /g, "+"), "base64");
    if (raw.length === 0) return null;
    try {
      return inflateRawSync(raw).toString("utf8");
    } catch {
      return raw.toString("utf8");
    }
  } catch {
    return null;
  }
}

function extractAuthnRequestIdFromRedirectUrl(redirectUrl: string): string | null {
  try {
    const url = new URL(redirectUrl);
    const samlRequest = url.searchParams.get("SAMLRequest");
    if (!samlRequest) return null;
    const requestXml = decodeBase64XmlPayload(samlRequest);
    if (!requestXml) return null;
    const match = requestXml.match(/<(?:\w+:)?AuthnRequest\b[^>]*\bID=(?:"([^"]+)"|'([^']+)')/i);
    return match?.[1] ?? match?.[2] ?? null;
  } catch {
    return null;
  }
}

function extractInResponseToFromValidatedResult(result: { profile: unknown } & Record<string, unknown>): string | null {
  const topLevel = result as Record<string, unknown>;
  const profile =
    result.profile && typeof result.profile === "object" ? (result.profile as Record<string, unknown>) : null;
  const candidates = [topLevel.InResponseTo, topLevel.inResponseTo, profile?.InResponseTo, profile?.inResponseTo];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

export class SamlProtocolHandler
  implements SsoProtocolHandler<SamlStartHandlerInput, SamlCallbackHandlerInput>
{
  public readonly protocol = "saml" as const;

  public async startAuthentication(input: SamlStartHandlerInput): Promise<SamlStartHandlerResult> {
    if (!input.cookieSecret) {
      throw new SamlConfigError("saml.provider_not_configured", "SSO state signing secret is missing.");
    }
    const initialState = buildSamlStateCookieValue(
      {
        providerId: input.provider.providerId,
        returnTo: input.returnTo,
        ttlMs: input.ttlMs,
      },
      input.cookieSecret
    );
    const saml = buildSamlInstance(input.provider);
    let redirectUrl: string;
    try {
      redirectUrl = await saml.getAuthorizeUrlAsync(initialState.state.relayState, undefined, {});
    } catch (error) {
      throw mapSamlInternalError(error, "saml.callback_failed");
    }
    const ttlMs = input.ttlMs ?? 10 * 60 * 1000;
    const requestId = extractAuthnRequestIdFromRedirectUrl(redirectUrl);
    const built = buildSamlStateCookieValue(
      {
        providerId: input.provider.providerId,
        returnTo: input.returnTo,
        ttlMs: input.ttlMs,
        relayState: initialState.state.relayState,
        requestId,
      },
      input.cookieSecret
    );
    return {
      kind: "redirect",
      protocol: this.protocol,
      redirectUrl,
      cookie: {
        name: input.cookieName,
        value: built.cookieValue,
        maxAgeSeconds: Math.max(1, Math.floor(ttlMs / 1000)),
      },
      state: built.state,
    };
  }

  public async handleCallback(input: SamlCallbackHandlerInput): Promise<SamlCallbackHandlerResult> {
    if (!input.cookieSecret) {
      throw new SamlConfigError("saml.provider_not_configured", "SSO state signing secret is missing.");
    }
    const state = validateSamlStateFromCookie(input.cookieValue, input.relayState, input.cookieSecret);
    if (state.providerId !== input.provider.providerId) {
      throw new SamlCallbackError("saml.relay_state_invalid", "RelayState providerId mismatch");
    }
    const saml = buildSamlInstance(input.provider);
    let result: ({ profile: unknown; loggedOut?: boolean } & Record<string, unknown>) | undefined;
    try {
      result = await saml.validatePostResponseAsync({
        SAMLResponse: input.samlResponse,
        RelayState: input.relayState,
      });
    } catch (error) {
      throw mapSamlInternalError(error, "saml.callback_failed");
    }
    if (!result || !result.profile || result.loggedOut) {
      throw new SamlCallbackError("saml.callback_failed", "SAML response did not produce a profile.");
    }
    const inResponseTo = extractInResponseToFromValidatedResult(result);
    if (!state.requestId || !inResponseTo || inResponseTo !== state.requestId) {
      throw new SamlCallbackError("saml.missing_in_response_to", "SAML InResponseTo mismatch or missing");
    }

    let identity: SsoExternalIdentity;
    try {
      identity = mapSamlProfileToIdentity(result.profile as Record<string, unknown>, input.provider.attributeMapping);
    } catch (error) {
      if (error instanceof SamlAttributeError) {
        throw new SamlCallbackError(error.code, error.message);
      }
      throw new SamlCallbackError("saml.callback_failed", error instanceof Error ? error.message : `${error}`);
    }
    return {
      protocol: this.protocol,
      identity,
      state,
    };
  }
}

/**
 * 把 @node-saml/node-saml 内部错误归一化到 saml.* 错误码。
 *
 * 库目前没有稳定的错误类型，只能字符串匹配。新增错误模式时同步扩展这里和测试矩阵。
 */
function mapSamlInternalError(error: unknown, fallbackCode: string): SamlCallbackError {
  const message = error instanceof Error ? error.message : `${error}`;
  const lower = message.toLowerCase();
  if (lower.includes("invalid signature") || lower.includes("signature does not match")) {
    return new SamlCallbackError("saml.invalid_signature", message, { cause: error });
  }
  if (lower.includes("notonorafter") || lower.includes("expired")) {
    return new SamlCallbackError("saml.expired_assertion", message, { cause: error });
  }
  if (lower.includes("notbefore")) {
    return new SamlCallbackError("saml.expired_assertion", message, { cause: error });
  }
  if (lower.includes("audience")) {
    return new SamlCallbackError("saml.invalid_audience", message, { cause: error });
  }
  if (lower.includes("issuer")) {
    return new SamlCallbackError("saml.invalid_issuer", message, { cause: error });
  }
  if (lower.includes("inresponseto")) {
    return new SamlCallbackError("saml.missing_in_response_to", message, { cause: error });
  }
  return new SamlCallbackError(fallbackCode, message, { cause: error });
}

export function createSamlProtocolHandler(): SamlProtocolHandler {
  return new SamlProtocolHandler();
}
