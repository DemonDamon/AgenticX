export type ChainVerifyPayload = {
  valid: boolean;
  at?: string;
  reason?: string;
  scanned: number;
  verification?: "full" | "partial";
  verified?: number;
  legacy_unverified?: number;
};

export function emptyAuditChainResult(): ChainVerifyPayload {
  return {
    valid: true,
    scanned: 0,
    verification: "full",
    verified: 0,
    legacy_unverified: 0,
  };
}

/**
 * First paint of the audit table must not wait for full-table chain verify.
 * Empty result sets skip the extra request (vacuous chain).
 */
export function auditListLoadPolicy(itemCount: number): {
  requestFullChainVerify: boolean;
  immediateChain: ChainVerifyPayload | null;
} {
  if (itemCount <= 0) {
    return { requestFullChainVerify: false, immediateChain: emptyAuditChainResult() };
  }
  return { requestFullChainVerify: true, immediateChain: null };
}
