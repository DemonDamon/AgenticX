export const BUSINESS_ERROR_CODES = {
  BAD_REQUEST: "40000",
  UNAUTHORIZED: "40100",
  FORBIDDEN: "40300",
  NOT_FOUND: "40400",
  RATE_LIMITED: "42900",
  INTERNAL: "50000",
} as const;

export const POLICY_ERROR_CODES = {
  REQUEST_BLOCKED: "90001",
  RESPONSE_BLOCKED: "90002",
} as const;

export function isPolicyErrorCode(code: string | undefined | null): boolean {
  if (!code) return false;
  return /^9\d{4}$/.test(code);
}

export function toComplianceMessage(code: string | undefined, fallback: string): string {
  if (code === BUSINESS_ERROR_CODES.FORBIDDEN) {
    return "当前账号未开通聊天权限（workspace:chat）。请重新登录，或联系管理员为账号分配聊天权限。";
  }
  if (!isPolicyErrorCode(code)) return fallback;
  if (code === POLICY_ERROR_CODES.REQUEST_BLOCKED) {
    return "请求触发合规策略，已被网关拦截。请调整输入后重试。";
  }
  if (code === POLICY_ERROR_CODES.RESPONSE_BLOCKED) {
    return "响应触发合规策略，网关已阻断返回。";
  }
  return "内容触发合规策略，已被网关拦截。";
}

