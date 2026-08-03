/**
 * Deep-research freezes the Gateway Bearer at request start. Long retrieve phases
 * can outlive the 1h access JWT; refresh in-place before synthesize so outline /
 * section writes do not all fail with Gateway 40100.
 */

export type RefreshAccessToken = () => Promise<{ accessToken: string } | null>;

/** Mutates `headers.authorization` when refresh succeeds. Returns whether it updated. */
export async function refreshGatewayBearer(args: {
  headers: Record<string, string>;
  refreshAccessToken: RefreshAccessToken;
}): Promise<boolean> {
  try {
    const next = await args.refreshAccessToken();
    const token = next?.accessToken?.trim();
    if (!token) return false;
    args.headers.authorization = `Bearer ${token}`;
    return true;
  } catch {
    return false;
  }
}
