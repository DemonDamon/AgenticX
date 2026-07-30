import {
  approveDesktopDeviceAuth,
  cancelDesktopDeviceAuth,
  claimApprovedDeviceAuth,
  completeDesktopDeviceAuth,
  createPat,
  ensureDesktopDeviceAuthFresh,
  getAdminUser,
  getDesktopDeviceAuth,
  initDesktopDeviceAuth,
  releaseDeviceAuthClaim,
  verifyDesktopDeviceSecret,
  type DesktopDeviceAuthRecord,
} from "@agenticx/iam-core";
import { DESKTOP_MANAGED_PAT_SCOPES } from "./desktop-auth";

export function desktopDeviceAuthTtlSeconds(): number {
  const raw = Number(process.env.DESKTOP_DEVICE_AUTH_TTL_SECONDS ?? "600");
  if (!Number.isFinite(raw) || raw <= 0) return 600;
  return Math.floor(raw);
}

export function desktopDeviceAuthPollIntervalMs(): number {
  const raw = Number(process.env.DESKTOP_DEVICE_AUTH_POLL_INTERVAL_MS ?? "2500");
  if (!Number.isFinite(raw) || raw <= 0) return 2500;
  return Math.floor(raw);
}

export function desktopPatExpireDays(): number {
  const raw = Number(process.env.DESKTOP_PAT_EXPIRE_DAYS ?? "90");
  if (!Number.isFinite(raw) || raw <= 0) return 90;
  return Math.floor(raw);
}

export function defaultTenantId(): string {
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim();
  if (!tenantId) throw new Error("DEFAULT_TENANT_ID is required");
  return tenantId;
}

export function buildDesktopVerificationUrl(origin: string, deviceId: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/auth/desktop?device=${encodeURIComponent(deviceId)}`;
}

/**
 * Prefer the client-facing Host (and optional forwarded proto) so Desktop's
 * organization URL (e.g. http://127.0.0.1:3000) matches verificationUrl origin.
 * Next.js may normalize request.url to localhost even when the client used 127.0.0.1.
 */
export function requestOriginFromRequest(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = (request.headers.get("x-forwarded-host") || "").split(",")[0]?.trim();
  const host = forwardedHost || (request.headers.get("host") || "").trim() || url.host;
  const forwardedProto = (request.headers.get("x-forwarded-proto") || "").split(",")[0]?.trim();
  const proto = (forwardedProto || url.protocol.replace(/:$/, "") || "https").toLowerCase();
  if (proto !== "http" && proto !== "https") {
    return url.origin;
  }
  return `${proto}://${host}`;
}

export async function startDesktopDeviceAuth(input: {
  deviceName?: string;
}): Promise<{
  deviceId: string;
  deviceSecret: string;
  expiresIn: number;
  pollIntervalMs: number;
}> {
  const result = await initDesktopDeviceAuth({
    tenantId: defaultTenantId(),
    deviceName: input.deviceName,
    ttlSeconds: desktopDeviceAuthTtlSeconds(),
  });
  return {
    deviceId: result.record.deviceId,
    deviceSecret: result.deviceSecret,
    expiresIn: result.expiresIn,
    pollIntervalMs: desktopDeviceAuthPollIntervalMs(),
  };
}

export async function approveDesktopDeviceForSession(input: {
  deviceId: string;
  tenantId: string;
  userId: string;
  deptId?: string | null;
}): Promise<DesktopDeviceAuthRecord> {
  return approveDesktopDeviceAuth(input);
}

export type DesktopDevicePollResult =
  | { status: "pending" }
  | { status: "issuing" }
  | {
      status: "completed";
      token: string;
      tokenId: number;
      user: {
        userId: string;
        email: string;
        displayName: string;
        tenantId: string;
        deptId: string | null;
      };
      expiresAt: string;
    }
  | { status: "expired" | "cancelled" | "consumed" };

export async function pollDesktopDeviceAuth(input: {
  deviceId: string;
  deviceSecret: string;
}): Promise<DesktopDevicePollResult> {
  const record = await ensureDesktopDeviceAuthFresh(input.deviceId);
  if (!record) {
    throw Object.assign(new Error("invalid device credentials"), { code: "40101" });
  }
  if (!verifyDesktopDeviceSecret(record, input.deviceSecret)) {
    throw Object.assign(new Error("invalid device credentials"), { code: "40101" });
  }

  if (record.status === "pending" || record.status === "issuing") {
    return { status: record.status === "issuing" ? "issuing" : "pending" };
  }
  if (record.status === "expired" || record.status === "cancelled" || record.status === "consumed") {
    return { status: record.status };
  }
  if (record.status !== "approved") {
    return { status: "expired" };
  }

  const claimed = await claimApprovedDeviceAuth(input.deviceId);
  if (!claimed) {
    const again = await getDesktopDeviceAuth(input.deviceId);
    if (again?.status === "consumed") return { status: "consumed" };
    return { status: "pending" };
  }

  try {
    const expireDays = desktopPatExpireDays();
    const pat = await createPat({
      tenantId: claimed.tenantId,
      userId: claimed.userId!,
      deptId: claimed.deptId,
      name: `和创智派 Desktop · ${claimed.deviceName}`,
      createdBy: claimed.userId!,
      expireDays,
      scopes: [...DESKTOP_MANAGED_PAT_SCOPES],
    });
    const completed = await completeDesktopDeviceAuth(input.deviceId, pat.record.id);
    if (!completed) {
      throw new Error("failed to mark device auth consumed");
    }
    const user = await getAdminUser(claimed.tenantId, claimed.userId!);
    if (!user || user.status === "disabled") {
      throw new Error("approved user unavailable");
    }
    return {
      status: "completed",
      token: pat.token,
      tokenId: pat.record.id,
      user: {
        userId: user.id,
        email: user.email,
        displayName: user.displayName ?? "",
        tenantId: claimed.tenantId,
        deptId: claimed.deptId,
      },
      expiresAt: new Date(Date.now() + expireDays * 24 * 60 * 60 * 1000).toISOString(),
    };
  } catch (error) {
    await releaseDeviceAuthClaim(input.deviceId).catch(() => null);
    throw error;
  }
}

export async function cancelDesktopDeviceAuthRequest(input: {
  deviceId: string;
  deviceSecret: string;
}): Promise<void> {
  await cancelDesktopDeviceAuth(input.deviceId, input.deviceSecret);
}

export async function loadDesktopDeviceAuthPublic(
  deviceId: string,
): Promise<Pick<DesktopDeviceAuthRecord, "deviceId" | "deviceName" | "status" | "expiresAt"> | null> {
  const record = await ensureDesktopDeviceAuthFresh(deviceId);
  if (!record) return null;
  return {
    deviceId: record.deviceId,
    deviceName: record.deviceName,
    status: record.status,
    expiresAt: record.expiresAt,
  };
}
