import type {
  BindResponse,
  ConfirmsResponse,
  ConfirmDecision,
  ConfirmResponse,
  MessagesResponse,
  MobileMessage,
  MobileSession,
  MobileStatus,
  SendRequest,
  SendResponse,
  SessionsResponse,
  UnbindResponse,
} from "./types";

/** 非 2xx 统一错误：status 供调用方分类（409/404/401...），detail 给用户看。 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`API ${status}: ${detail}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/** 401 回调：调用方注入「清除绑定态 + 跳配对页」的逻辑。 */
export type UnauthorizedHandler = () => void;

export interface GatewayClientOptions {
  /** 扫码得到的 gateway 根 URL，如 `https://gw.example.com` */
  gatewayBase: string;
  /** 本机安装标识（随 x-agx-install-id 头发送） */
  installId: string;
  /** bind 之外的所有接口都需要 */
  mobileToken?: string;
  onUnauthorized?: UnauthorizedHandler;
}

const STATUS_FALLBACK: Record<number, string> = {
  400: "请求无效",
  401: "未授权",
  403: "禁止访问",
  404: "资源不存在",
  409: "请求冲突",
  500: "服务器内部错误",
  502: "网关错误",
  503: "服务不可用",
  504: "网关超时",
};

function fallbackDetail(status: number): string {
  return STATUS_FALLBACK[status] ?? `请求失败（HTTP ${status}）`;
}

function extractDetail(body: unknown): string | null {
  if (body !== null && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string" && detail.length > 0) return detail;
  }
  return null;
}

/** studio 的 updated_at 是秒级浮点；<1e12 判定为秒，转毫秒 */
function toMillis(value: unknown): number {
  if (typeof value === "number") {
    return value < 1e12 ? value * 1000 : value;
  }
  const parsed = Date.parse(typeof value === "string" ? value : "");
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * studio 线格式 → 手机端契约：
 * session_id→id，session_name→title，execution_state→running，秒级时间→毫秒。
 * 保留其余原始字段，后端演进时不丢数据。
 */
function normalizeSession(raw: Record<string, unknown>): MobileSession {
  const id = String(raw.session_id ?? raw.id ?? "");
  const title = String(raw.session_name ?? raw.title ?? "");
  const state = raw.execution_state;
  const running =
    typeof raw.running === "boolean"
      ? raw.running
      : typeof state === "string"
        ? state !== "idle"
        : false;
  return {
    ...raw,
    id,
    title,
    updated_at: toMillis(raw.updated_at ?? raw.last_activity_at),
    running,
  };
}

/** studio 消息线格式 → 手机端契约：content→text，timestamp→ts */
function normalizeMessage(raw: Record<string, unknown>): MobileMessage {
  return {
    ...raw,
    role: (raw.role as MobileMessage["role"]) ?? "system",
    text: String(raw.text ?? raw.content ?? ""),
    ts: typeof raw.timestamp === "number" ? raw.timestamp : toMillis(raw.timestamp),
  };
}

/**
 * Gateway REST client。
 *
 * - 鉴权：除 bind 外全部带 `x-agx-install-id` 与 `x-agx-mobile-token`
 * - 错误：非 2xx 抛 `ApiError {status, detail}`；网络层错误（网关不可达）原样抛
 *   fetch 的 TypeError，由调用方按「网关不可达」分类
 * - 401：先触发 `onUnauthorized` 回调，再抛 ApiError
 */
export class GatewayClient {
  private readonly gatewayBase: string;
  private readonly installId: string;
  private readonly mobileToken: string | undefined;
  private readonly onUnauthorized: UnauthorizedHandler | undefined;

  constructor(options: GatewayClientOptions) {
    this.gatewayBase = options.gatewayBase.replace(/\/+$/, "");
    this.installId = options.installId;
    this.mobileToken = options.mobileToken;
    this.onUnauthorized = options.onUnauthorized;
  }

  /** 扫码绑定。请求体 `{connect_session_id, install_id}`，无需 token。 */
  async bind(connectSessionId: string): Promise<BindResponse> {
    return await this.request<BindResponse>(
      "POST",
      "/api/mobile/bind",
      {
        connect_session_id: connectSessionId,
        install_id: this.installId,
      },
      { skipAuth: true },
    );
  }

  async getStatus(): Promise<MobileStatus> {
    return await this.request<MobileStatus>("GET", "/api/mobile/status");
  }

  async getSessions(): Promise<SessionsResponse> {
    const resp = await this.request<SessionsResponse>("GET", "/api/mobile/sessions");
    const rows = (resp as { sessions?: unknown[] }).sessions ?? [];
    return {
      sessions: rows
        .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
        .map(normalizeSession),
    };
  }

  async getMessages(sessionId: string): Promise<MessagesResponse> {
    const resp = await this.request<MessagesResponse>(
      "GET",
      `/api/mobile/sessions/${encodeURIComponent(sessionId)}/messages`,
    );
    const rows = (resp as { messages?: unknown[] }).messages ?? [];
    return {
      messages: rows
        .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
        .map(normalizeMessage),
    };
  }

  async sendMessage(sessionId: string, body: SendRequest): Promise<SendResponse> {
    return await this.request<SendResponse>(
      "POST",
      `/api/mobile/sessions/${encodeURIComponent(sessionId)}/send`,
      body,
    );
  }

  async getConfirms(): Promise<ConfirmsResponse> {
    return await this.request<ConfirmsResponse>("GET", "/api/mobile/confirms");
  }

  async decideConfirm(requestId: string, decision: ConfirmDecision): Promise<ConfirmResponse> {
    return await this.request<ConfirmResponse>(
      "POST",
      `/api/mobile/confirms/${encodeURIComponent(requestId)}`,
      decision,
    );
  }

  async unbind(): Promise<UnbindResponse> {
    return await this.request<UnbindResponse>("DELETE", "/api/mobile/bindings");
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { skipAuth?: boolean },
  ): Promise<T> {
    const url = `${this.gatewayBase}${path}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts?.skipAuth !== true) {
      headers["x-agx-install-id"] = this.installId;
      if (this.mobileToken !== undefined) {
        headers["x-agx-mobile-token"] = this.mobileToken;
      }
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const raw = await response.text();
    let parsed: unknown;
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = undefined;
      }
    } else {
      parsed = undefined;
    }

    if (!response.ok) {
      if (response.status === 401) {
        this.onUnauthorized?.();
      }
      throw new ApiError(
        response.status,
        extractDetail(parsed) ?? fallbackDetail(response.status),
      );
    }

    if (parsed === undefined) {
      throw new ApiError(response.status, "网关返回了非 JSON 响应");
    }
    return parsed as T;
  }
}
