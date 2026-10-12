import { ApiError } from "../api/client";

/** 网关 503 "device offline"（后端 _bridge_device_rpc 的设备离线语义）。 */
export function isDeviceOfflineError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503 && /offline/i.test(err.detail);
}

/** 把任意错误映射为人话（网关不可达 / 设备离线 / 桌面超时 / 后端 detail）。 */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (isDeviceOfflineError(err)) return "桌面端离线";
    if (err.status === 504) return "桌面端响应超时";
    return err.detail;
  }
  // fetch 网络层错误（TypeError 等）：网关不可达
  return "无法连接网关，请检查网络";
}
