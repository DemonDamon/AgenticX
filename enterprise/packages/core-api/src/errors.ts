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

function appendRequestId(message: string, traceId?: string): string {
  const tid = traceId?.trim();
  if (!tid || message.includes("\n请求 ID: ")) return message;
  return `${message}\n请求 ID: ${tid}`;
}

export function toComplianceMessage(
  code: string | undefined,
  fallback: string,
  traceId?: string,
): string {
  let message: string;
  if (code === BUSINESS_ERROR_CODES.UNAUTHORIZED) {
    message = "登录态已失效或网关鉴权失败，请重新登录后再试。若持续失败，请联系管理员检查网关 JWT 配置。";
  } else if (code === BUSINESS_ERROR_CODES.FORBIDDEN) {
    message = "当前账号未开通聊天权限（workspace:chat）。请重新登录，或联系管理员为账号分配聊天权限。";
  } else if (code === "42901") {
    message = "Token 配额已用尽，请联系管理员调整额度后再继续使用。";
  } else if (!isPolicyErrorCode(code)) {
    message = fallback;
  } else if (fallback.includes("命中策略")) {
    // 网关已把命中策略拼入 message 时，优先保留具体原因，避免前端只显示泛化文案。
    message = fallback;
  } else if (code === POLICY_ERROR_CODES.REQUEST_BLOCKED) {
    message = "请求触发合规策略，已被网关拦截。请调整输入后重试。";
  } else if (code === POLICY_ERROR_CODES.RESPONSE_BLOCKED) {
    message = "响应触发合规策略，网关已阻断返回。";
  } else {
    message = "内容触发合规策略，已被网关拦截。";
  }
  return appendRequestId(message, traceId);
}
