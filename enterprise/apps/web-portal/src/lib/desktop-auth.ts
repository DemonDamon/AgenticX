import { getAdminUser, touchPatLastUsed, verifyPat } from "@agenticx/iam-core";

export type DesktopIdentity = {
  userId: string;
  tenantId: string;
  deptId: string | null;
  email: string;
  displayName: string;
  tokenId: number;
};

/**
 * Resolve Desktop Bearer PAT (agx-pat-*) to a portal identity.
 * Updates last_used_at on success.
 */
export async function resolveDesktopIdentity(request: Request): Promise<DesktopIdentity | null> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1]?.trim() ?? "";
  if (!token.startsWith("agx-pat-")) return null;

  const verified = await verifyPat(token);
  if (!verified) return null;

  const user = await getAdminUser(verified.tenantId, verified.userId);
  if (!user || user.status === "disabled") return null;

  void touchPatLastUsed(verified.id).catch(() => {
    /* best-effort */
  });

  return {
    userId: verified.userId,
    tenantId: verified.tenantId,
    deptId: verified.deptId ?? user.deptId ?? null,
    email: user.email,
    displayName: user.displayName ?? "",
    tokenId: verified.id,
  };
}
