/**
 * SSO 协议适配层接口（M2）。
 *
 * 设计目标：把「协议相关的 IdP 通信细节」抽象到统一接口，
 * 让 OIDC 和 SAML 在 portal / admin route 中以同样的形态被调用，
 * 避免 SAML 在 M3 阶段重新发明 state/cookie/claim 拼装套路。
 *
 * 职责边界：
 * - handler 只处理「协议专属」步骤（OIDC: discovery / buildAuthorizationUrl /
 *   authorization code grant / id_token claim 解析；SAML: AuthnRequest 构造 /
 *   SAMLResponse 验签与断言解析）。
 * - handler 不处理 state cookie 加密、portal/admin 政策层、JIT 落库、审计。
 *   这些跨协议的横切关注点继续由 route 与 sso-runtime 层管理。
 */

export type SsoProtocol = "oidc" | "saml";

export type SsoStartCookie = {
  name: string;
  value: string;
  maxAgeSeconds: number;
};

export type SsoStartResult =
  | {
      kind: "redirect";
      protocol: SsoProtocol;
      redirectUrl: string;
      cookie?: SsoStartCookie;
    }
  | {
      kind: "form_post";
      protocol: SsoProtocol;
      htmlBody: string;
      cookie?: SsoStartCookie;
    };

/**
 * 协议归一后的外部身份；route / 政策层仅看这个结构，
 * 不再直接消费 OIDC claims 或 SAML attributes 原文。
 */
export type SsoExternalIdentity = {
  externalSubject: string;
  email: string;
  displayName?: string;
  deptHint?: string | null;
  roleCodeHints?: string[];
  rawAttributes: Record<string, unknown>;
  rawTokens?: unknown;
};

export type SsoCallbackResult = {
  protocol: SsoProtocol;
  identity: SsoExternalIdentity;
};

export interface SsoProtocolHandler<StartInput, CallbackInput> {
  readonly protocol: SsoProtocol;
  startAuthentication(input: StartInput): Promise<SsoStartResult>;
  handleCallback(input: CallbackInput): Promise<SsoCallbackResult>;
}
