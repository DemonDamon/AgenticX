import { mapClaimsToAuthUser, type OidcMappedUser } from "./oidc-claims";
import {
  OidcCallbackError,
  OidcClientService,
  OidcConfigError,
  type OidcProviderConfig,
} from "./oidc-client";
import {
  buildStateCookieValue,
  DEFAULT_OIDC_STATE_COOKIE,
  validateStateFromCookie,
  type OidcStatePayload,
} from "./oidc-state";
import type {
  SsoCallbackResult,
  SsoExternalIdentity,
  SsoProtocolHandler,
  SsoStartResult,
} from "./sso-protocol-handler";

export type OidcStartHandlerInput = {
  provider: OidcProviderConfig;
  cookieSecret: string;
  returnTo?: string;
  cookieName?: string;
  ttlMs?: number;
};

export type OidcCallbackHandlerInput = {
  provider: OidcProviderConfig;
  cookieSecret: string;
  cookieValue: string | undefined | null;
  callbackUrl: string;
  expectedState: string;
};

export type OidcStartHandlerResult = Extract<SsoStartResult, { kind: "redirect" }> & {
  state: OidcStatePayload;
};

export type OidcCallbackHandlerResult = SsoCallbackResult & {
  state: OidcStatePayload;
};

export class OidcProtocolHandler
  implements SsoProtocolHandler<OidcStartHandlerInput, OidcCallbackHandlerInput>
{
  public readonly protocol = "oidc" as const;

  public constructor(private readonly client: OidcClientService = new OidcClientService()) {}

  public async startAuthentication(input: OidcStartHandlerInput): Promise<OidcStartHandlerResult> {
    if (!input.cookieSecret) {
      throw new OidcConfigError("oidc.state_secret_missing", "SSO state signing secret is missing.");
    }
    const codeVerifier = this.client.createCodeVerifier();
    const cookieName = input.cookieName ?? DEFAULT_OIDC_STATE_COOKIE;
    const ttlMs = input.ttlMs ?? 10 * 60 * 1000;
    const built = buildStateCookieValue(
      {
        providerId: input.provider.providerId,
        returnTo: input.returnTo,
        codeVerifier,
        ttlMs,
      },
      input.cookieSecret
    );
    const redirectUrl = await this.client.buildAuthorizationUrl({
      provider: input.provider,
      state: built.state.state,
      nonce: built.state.nonce,
      codeVerifier: built.state.codeVerifier,
      returnTo: input.returnTo,
    });
    return {
      kind: "redirect",
      protocol: this.protocol,
      redirectUrl,
      cookie: {
        name: cookieName,
        value: built.cookieValue,
        maxAgeSeconds: Math.max(1, Math.floor(ttlMs / 1000)),
      },
      state: built.state,
    };
  }

  public async handleCallback(input: OidcCallbackHandlerInput): Promise<OidcCallbackHandlerResult> {
    if (!input.cookieSecret) {
      throw new OidcConfigError("oidc.state_secret_missing", "SSO state signing secret is missing.");
    }
    const state = validateStateFromCookie(input.cookieValue, input.expectedState, input.cookieSecret);
    if (state.providerId !== input.provider.providerId) {
      throw new OidcCallbackError("oidc.invalid_state_payload", "State payload provider mismatch.");
    }
    const exchanged = await this.client.exchangeCallback({
      provider: input.provider,
      callbackUrl: input.callbackUrl,
      expectedState: state.state,
      expectedNonce: state.nonce,
      codeVerifier: state.codeVerifier,
    });
    const identity: SsoExternalIdentity = mapToExternalIdentity(exchanged.mapped, exchanged.claims, exchanged.rawTokens);
    return {
      protocol: this.protocol,
      identity,
      state,
    };
  }
}

function mapToExternalIdentity(
  mapped: OidcMappedUser,
  claims: Record<string, unknown>,
  rawTokens: unknown
): SsoExternalIdentity {
  return {
    externalSubject: mapped.externalId ?? "",
    email: mapped.email,
    displayName: mapped.displayName,
    deptHint: mapped.deptHint ?? null,
    roleCodeHints: mapped.roleCodeHints,
    rawAttributes: claims,
    rawTokens,
  };
}

/**
 * portal/admin route 短期内仍可直接调用 OidcClientService；
 * 也可以用本函数拿到与 SAML handler 同接口的 OidcProtocolHandler 实例，
 * 方便后续把 route 收敛到 protocol-router。
 */
export function createOidcProtocolHandler(client?: OidcClientService): OidcProtocolHandler {
  return new OidcProtocolHandler(client ?? new OidcClientService());
}

export { mapClaimsToAuthUser };
