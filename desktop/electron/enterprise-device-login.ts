// 企业门户设备授权登录（桌面侧客户端）。
//
// 与 Near 官网账号（agxbuilder.com）那套设备流**不是同一个协议**：
// 企业侧 poll 是 POST + body { deviceId, deviceSecret }，官网侧是 GET + query。
// 这里只做纯粹的 HTTP 客户端，不 import electron、不读磁盘，便于单测。

import { normalizePortalBase } from "./collab-room-client";

export type EnterpriseLoginDeps = {
  baseUrl: string;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
};

export type EnterpriseLoginStart = {
  deviceId: string;
  deviceSecret: string;
  verificationUrl: string;
  expiresIn: number;
  pollIntervalMs: number;
};

export type EnterpriseLoginUser = {
  userId: string;
  email: string;
  displayName: string;
  tenantId: string;
  deptId: string | null;
};

export type EnterpriseLoginPoll =
  | { status: "pending" }
  | { status: "completed"; token: string; user: EnterpriseLoginUser; expiresAt: string }
  | { status: "gone"; error: string };

export type EnterpriseLoginResult<T> = { ok: true; data: T } | { ok: false; error: string };

const MISSING_PORTAL = "请先填写企业门户地址";
const WRONG_PORTAL = "该地址不是可用的企业门户";
const TOO_MANY = "请求过于频繁，请稍后再试";
const UNREACHABLE = "无法连接企业门户，请检查地址与网络";
const GONE_EXPIRED = "授权请求已失效，请重新发起登录";
const GONE_INVALID = "授权信息无效，请重新发起登录";

function requestFetch(deps: EnterpriseLoginDeps) {
  return deps.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
}

function postInit(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  };
}

export async function startEnterpriseDeviceAuth(
  deps: EnterpriseLoginDeps,
  deviceName: string,
): Promise<EnterpriseLoginResult<EnterpriseLoginStart>> {
  const base = normalizePortalBase(deps.baseUrl);
  if (!base) return { ok: false, error: MISSING_PORTAL };
  try {
    const res = await requestFetch(deps)(
      `${base}/api/desktop/auth/device/init`,
      postInit({ deviceName }),
    );
    if (!res.ok) {
      if (res.status === 404) return { ok: false, error: WRONG_PORTAL };
      if (res.status === 429) return { ok: false, error: TOO_MANY };
      return { ok: false, error: UNREACHABLE };
    }
    const json = (await res.json()) as { data?: Partial<EnterpriseLoginStart> };
    const data = json?.data;
    if (!data?.deviceId || !data.deviceSecret || !data.verificationUrl) {
      return { ok: false, error: WRONG_PORTAL };
    }
    return {
      ok: true,
      data: {
        deviceId: data.deviceId,
        deviceSecret: data.deviceSecret,
        // 门户按 x-forwarded-host 算好了 origin；自己重拼会在 localhost / 127.0.0.1
        // 之间错配，导致批准页与会话 cookie 不同域、批准后仍停在 pending。
        verificationUrl: data.verificationUrl,
        expiresIn: typeof data.expiresIn === "number" ? data.expiresIn : 600,
        pollIntervalMs: typeof data.pollIntervalMs === "number" ? data.pollIntervalMs : 2500,
      },
    };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function pollEnterpriseDeviceAuth(
  deps: EnterpriseLoginDeps,
  input: { deviceId: string; deviceSecret: string },
): Promise<EnterpriseLoginResult<EnterpriseLoginPoll>> {
  const base = normalizePortalBase(deps.baseUrl);
  if (!base) return { ok: false, error: MISSING_PORTAL };
  try {
    const res = await requestFetch(deps)(
      `${base}/api/desktop/auth/device/poll`,
      postInit({ deviceId: input.deviceId, deviceSecret: input.deviceSecret }),
    );
    // 限流不是失败，等下一拍即可。
    if (res.status === 429) return { ok: true, data: { status: "pending" } };
    if (res.status === 410) return { ok: true, data: { status: "gone", error: GONE_EXPIRED } };
    if (res.status === 401) return { ok: true, data: { status: "gone", error: GONE_INVALID } };
    if (!res.ok) return { ok: false, error: UNREACHABLE };

    const json = (await res.json()) as {
      data?: {
        status?: string;
        token?: string;
        user?: Partial<EnterpriseLoginUser>;
        expiresAt?: string;
      };
    };
    const data = json?.data;
    if (data?.status === "completed") {
      const user = data.user;
      if (!data.token || !user?.userId) return { ok: false, error: UNREACHABLE };
      return {
        ok: true,
        data: {
          status: "completed",
          token: data.token,
          user: {
            userId: user.userId,
            email: user.email ?? "",
            displayName: user.displayName ?? "",
            tenantId: user.tenantId ?? "",
            deptId: user.deptId ?? null,
          },
          expiresAt: data.expiresAt ?? "",
        },
      };
    }
    return { ok: true, data: { status: "pending" } };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function cancelEnterpriseDeviceAuth(
  deps: EnterpriseLoginDeps,
  input: { deviceId: string; deviceSecret: string },
): Promise<void> {
  const base = normalizePortalBase(deps.baseUrl);
  if (!base) return;
  try {
    await requestFetch(deps)(
      `${base}/api/desktop/auth/device/cancel`,
      postInit({ deviceId: input.deviceId, deviceSecret: input.deviceSecret }),
    );
  } catch {
    /* best-effort */
  }
}
