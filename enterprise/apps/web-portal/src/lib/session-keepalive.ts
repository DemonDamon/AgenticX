export const SESSION_RENEW_WITHIN_MS = 10 * 60 * 1000;

export type SessionKeepalivePrincipal = {
  tenantId: string;
  userId: string;
};

export type SessionKeepaliveResult = SessionKeepalivePrincipal & {
  expiresAt: string;
};

type SessionKeepaliveResponse = {
  ok: boolean;
  json(): Promise<unknown>;
};

export type SessionKeepaliveDeps = {
  expectedPrincipal: SessionKeepalivePrincipal | null;
  fetcher(input: string, init: RequestInit): Promise<SessionKeepaliveResponse>;
  isActive(): boolean;
  onPrincipalMismatch(): void;
  onRenewed(result: SessionKeepaliveResult): void;
};

/** Visible pages renew only when the access token is inside the last 10 minutes. */
export function shouldRenewVisibleSession(
  expiresAtMs: number | null,
  nowMs: number,
  visible: boolean,
): boolean {
  if (!visible) return false;
  if (expiresAtMs == null || !Number.isFinite(expiresAtMs)) return true;
  return expiresAtMs - nowMs < SESSION_RENEW_WITHIN_MS;
}

/**
 * Ask the portal to rotate the session cookie. A different tenant or user
 * must not replace the page's current principal.
 */
export async function refreshSessionKeepalive(deps: SessionKeepaliveDeps): Promise<void> {
  try {
    if (!deps.isActive()) return;
    const response = await deps.fetcher("/api/auth/refresh?format=json", {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (!response.ok || !deps.isActive()) return;
    const json = (await response.json()) as {
      data?: { tenantId?: string; userId?: string; expiresAt?: string };
    };
    if (!deps.isActive()) return;
    const tenantId = json.data?.tenantId?.trim();
    const userId = json.data?.userId?.trim();
    const expiresAt = json.data?.expiresAt?.trim();
    if (!tenantId || !userId || !expiresAt || !deps.isActive()) return;
    const expected = deps.expectedPrincipal;
    if (
      expected &&
      (expected.tenantId !== tenantId || expected.userId !== userId)
    ) {
      deps.onPrincipalMismatch();
      return;
    }
    deps.onRenewed({ tenantId, userId, expiresAt });
  } catch {
    // The next focus or timer check can retry a transient failure.
  }
}
