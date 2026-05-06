/**
 * Single source for SSO / OIDC error codes shown on login pages (FR-D2).
 */
export const OIDC_PORTAL_ERROR_MESSAGES_EN: Record<string, string> = {
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
};

export const OIDC_PORTAL_ERROR_MESSAGES_ZH: Record<string, string> = {
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
