import type { SsoExternalIdentity, SsoProtocol } from "./sso-protocol-handler";

export type SsoAudience = "portal" | "admin";

/**
 * portal / admin 政策层共享的归一化登录请求体。
 *
 * portal/admin runtime 仍各自负责 JIT 落库（portal）与「预开户 + admin:enter」
 * 校验（admin）。本类型只是把协议无关的字段统一收口，避免每个协议都重新拼装。
 */
export type NormalizedSsoLoginInput = {
  protocol: SsoProtocol;
  providerId: string;
  issuer: string | null;
  audience: SsoAudience;
  email: string;
  displayName: string;
  externalSubject: string | null;
  deptHint: string | null;
  roleCodeHints: string[];
};

export function buildNormalizedSsoLoginInput(args: {
  audience: SsoAudience;
  protocol: SsoProtocol;
  providerId: string;
  issuer: string | null;
  identity: SsoExternalIdentity;
}): NormalizedSsoLoginInput {
  return {
    protocol: args.protocol,
    providerId: args.providerId,
    issuer: args.issuer,
    audience: args.audience,
    email: args.identity.email,
    displayName: args.identity.displayName ?? args.identity.email,
    externalSubject: args.identity.externalSubject || null,
    deptHint: args.identity.deptHint ?? null,
    roleCodeHints: args.identity.roleCodeHints ?? [],
  };
}
