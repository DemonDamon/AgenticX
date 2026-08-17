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

const DEFAULT_SERVE_STARTUP_TIMEOUT_MS = 45_000;
const WINDOWS_SERVE_STARTUP_TIMEOUT_MS = 90_000;

export function getServeStartupTimeoutMs(
  platform: NodeJS.Platform = process.platform,
): number {
  return platform === "win32"
    ? WINDOWS_SERVE_STARTUP_TIMEOUT_MS
    : DEFAULT_SERVE_STARTUP_TIMEOUT_MS;
}
