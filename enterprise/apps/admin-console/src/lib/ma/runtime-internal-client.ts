import { getMaInternalToken } from "./internal-auth";

// MA-E12 admin → agent-runtime client. MA-A10 may add sibling helpers in this file.

export class MaRuntimeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaRuntimeUnavailableError";
  }
}

export class MaRuntimeRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MaRuntimeRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function runtimeInternal<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const base = process.env.MA_RUNTIME_INTERNAL_URL?.trim() || "http://127.0.0.1:8092";
  const token = getMaInternalToken();
  if (!token) throw new MaRuntimeUnavailableError("运行时内部令牌未配置");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new MaRuntimeUnavailableError("评测运行时不可达");
  } finally {
    clearTimeout(timer);
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
    const code = typeof error.code === "string" ? error.code : "internal_error";
    const message = typeof error.message === "string" ? error.message : "评测运行时请求失败";
    throw new MaRuntimeRequestError(response.status, code, message);
  }
  return payload as T;
}
