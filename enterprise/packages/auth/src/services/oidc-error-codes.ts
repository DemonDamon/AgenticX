/**
 * Single source for SSO / OIDC + SAML error codes shown on login pages (FR-D2).
 *
 * 命名空间约定：
 * - `oidc.*` 历史保留，OIDC 链路用。
 * - `saml.*` 新增，SAML 链路用。`oidc-error-codes.ts` 文件名出于兼容保留，不重命名。
 */
export const OIDC_PORTAL_ERROR_MESSAGES_EN: Record<string, string> = {
  "oidc.provider_not_configured": "SSO provider is not configured. Sign in with password or contact your administrator.",
  "oidc.discovery_failed": "SSO service is temporarily unavailable. Try again or sign in with password.",
  "oidc.invalid_state": "SSO session state is invalid. Start sign-in again.",
  "oidc.state_cookie_missing": "SSO session cookie is missing. Start sign-in again.",
  "oidc.state_expired": "SSO session expired. Start sign-in again.",
  "oidc.invalid_state_cookie": "SSO session cookie is invalid. Start sign-in again.",
  "oidc.invalid_state_payload": "SSO session payload is invalid. Start sign-in again.",
  "oidc.account_disabled": "This account is disabled or locked. Contact your administrator.",
  "oidc.provider_disabled": "This SSO provider is disabled. Contact your administrator.",
  "oidc.state_secret_missing": "SSO is misconfigured (missing signing secret). Contact your administrator.",
  "oidc.callback_failed": "SSO callback failed. Retry or contact your administrator.",
  "oidc.invalid_nonce": "SSO security check failed (nonce). Sign in again.",
  "oidc.invalid_redirect_uri": "Redirect URI is misconfigured for SSO. Contact your administrator.",
  "oidc.unsupported_runtime": "SSO runtime component missing. Contact your administrator.",
  "oidc.claim.email_missing": "ID token is missing a usable email claim.",
  "saml.provider_not_configured": "SAML SSO provider is not configured. Contact your administrator.",
  "saml.provider_disabled": "SAML SSO provider is disabled. Contact your administrator.",
  "saml.state_secret_missing": "SAML state signing secret is missing. Contact your administrator.",
  "saml.start_failed": "SAML sign-in start failed. Retry or contact your administrator.",
  "saml.invalid_signature": "SAML response signature is invalid. Contact your administrator.",
  "saml.expired_assertion": "SAML assertion expired. Sign in again.",
  "saml.invalid_audience": "SAML audience is misconfigured. Contact your administrator.",
  "saml.invalid_issuer": "SAML issuer mismatch. Contact your administrator.",
  "saml.missing_in_response_to": "SAML InResponseTo missing or mismatched. Sign in again.",
  "saml.relay_state_invalid": "SAML relay state is invalid. Sign in again.",
  "saml.relay_state_expired": "SAML relay state expired. Sign in again.",
  "saml.attribute_email_missing": "SAML response is missing a usable email attribute.",
  "saml.callback_failed": "SAML callback failed. Retry or contact your administrator.",
};

export const OIDC_PORTAL_ERROR_MESSAGES_ZH: Record<string, string> = {
  "oidc.provider_not_configured": "SSO Provider 尚未配置，请先使用账号密码登录或联系管理员配置企业 IdP",
  "oidc.discovery_failed": "SSO 服务暂不可用，请稍后重试或使用账号密码登录",
  "oidc.invalid_state": "SSO 登录状态失效，请重新发起登录",
  "oidc.state_cookie_missing": "SSO 登录状态缺失，请重新发起登录",
  "oidc.state_expired": "SSO 登录状态已过期，请重新发起登录",
  "oidc.invalid_state_cookie": "SSO 登录状态无效，请重新发起登录",
  "oidc.invalid_state_payload": "SSO 登录状态数据无效，请重新发起登录",
  "oidc.account_disabled": "账号已被禁用或锁定，请联系管理员",
  "oidc.provider_disabled": "当前 SSO Provider 已停用，请联系管理员",
  "oidc.state_secret_missing": "SSO 配置缺失，请联系管理员",
  "oidc.callback_failed": "SSO 回调处理失败，请重试或联系管理员",
  "oidc.invalid_nonce": "SSO 安全校验失败（nonce），请重新登录",
  "oidc.invalid_redirect_uri": "SSO 回调地址配置不合法，请联系管理员检查 Redirect URI",
  "oidc.unsupported_runtime": "SSO 运行时组件缺失，请联系管理员",
  "oidc.claim.email_missing": "身份令牌缺少邮箱信息，无法完成登录",
  "saml.provider_not_configured": "SAML SSO Provider 尚未配置，请联系管理员",
  "saml.provider_disabled": "当前 SAML SSO Provider 已停用，请联系管理员",
  "saml.state_secret_missing": "SAML 状态签名密钥缺失，请联系管理员",
  "saml.start_failed": "SAML 登录发起失败，请重试或联系管理员",
  "saml.invalid_signature": "SAML 响应签名无效，请联系管理员",
  "saml.expired_assertion": "SAML 断言已过期，请重新登录",
  "saml.invalid_audience": "SAML Audience 配置不匹配，请联系管理员",
  "saml.invalid_issuer": "SAML Issuer 不匹配，请联系管理员",
  "saml.missing_in_response_to": "SAML InResponseTo 缺失或不一致，请重新登录",
  "saml.relay_state_invalid": "SAML RelayState 无效，请重新登录",
  "saml.relay_state_expired": "SAML RelayState 已过期，请重新登录",
  "saml.attribute_email_missing": "SAML 响应缺少邮箱属性，无法完成登录",
  "saml.callback_failed": "SAML 回调处理失败，请重试或联系管理员",
};

export const OIDC_ADMIN_ERROR_MESSAGES_EN: Record<string, string> = {
  ...OIDC_PORTAL_ERROR_MESSAGES_EN,
  admin_unprovisioned: "This account is not provisioned in Admin. Ask an admin to assign access.",
  admin_scope_missing: "Your account lacks admin:enter and cannot open the admin console.",
  account_disabled: "Account is disabled or locked. Contact your administrator.",
  tenant_missing: "Tenant is not configured; SSO cannot complete.",
};

export const OIDC_ADMIN_ERROR_MESSAGES_ZH: Record<string, string> = {
  ...OIDC_PORTAL_ERROR_MESSAGES_ZH,
  admin_unprovisioned: "当前账号未在管理后台开通，请联系超管分配权限",
  admin_scope_missing: "当前账号缺少 admin:enter 权限，无法进入管理后台",
  account_disabled: "账号已停用或锁定，请联系管理员",
  tenant_missing: "租户未配置，无法完成 SSO 登录",
};

/** Union of known OIDC / admin SSO error codes (single source for docs & UI). */
export const OIDC_ERROR_CODES: readonly string[] = Object.freeze([
  ...new Set([...Object.keys(OIDC_PORTAL_ERROR_MESSAGES_ZH), ...Object.keys(OIDC_ADMIN_ERROR_MESSAGES_ZH)]),
]);

export function getPortalSsoErrorMessageZh(code: string): string {
  return OIDC_PORTAL_ERROR_MESSAGES_ZH[code] ?? `SSO 登录失败（${code}）`;
}

export function getAdminSsoErrorMessageZh(code: string): string {
  return OIDC_ADMIN_ERROR_MESSAGES_ZH[code] ?? `SSO 登录失败（${code}）`;
}

export function getPortalSsoErrorMessageEn(code: string): string {
  return OIDC_PORTAL_ERROR_MESSAGES_EN[code] ?? `SSO sign-in failed (${code})`;
}

export function getAdminSsoErrorMessageEn(code: string): string {
  return OIDC_ADMIN_ERROR_MESSAGES_EN[code] ?? `SSO sign-in failed (${code})`;
}
