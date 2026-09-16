/**
 * Narrow Desktop startup policy shared by the Electron launcher and its tests.
 *
 * Keep the local backend boot path independent from optional public-network
 * metadata. Windows also needs a larger cold-start budget because antivirus
 * scanning the bundled executable can make the first launch slower.
 */

export const LOCAL_BACKEND_STARTUP_ENV = {
  LITELLM_LOCAL_MODEL_COST_MAP: "true",
} as const;

export const SERVE_READY_PROBE_TIMEOUT_MS = 2_000;

// macOS/Linux 也用大预算：用户机器首次启动会叠加 Gatekeeper 全量扫描
// (~400MB bundle) 与磁盘冷读，45s 在真实用户机器上不够（CI 自己的
// backend smoke test 都允许 60s）。Windows 120s 的理由（杀软扫描）同样
// 适用于 macOS 的首次 Gatekeeper 检查。
const DEFAULT_SERVE_STARTUP_TIMEOUT_MS = 120_000;
const WINDOWS_SERVE_STARTUP_TIMEOUT_MS = 120_000;

export function getServeStartupTimeoutMs(
  platform: NodeJS.Platform = process.platform,
): number {
  return platform === "win32"
    ? WINDOWS_SERVE_STARTUP_TIMEOUT_MS
    : DEFAULT_SERVE_STARTUP_TIMEOUT_MS;
}
