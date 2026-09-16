import { describe, expect, it } from "vitest";
import { auditListLoadPolicy, emptyAuditChainResult } from "../audit-list-load";

describe("auditListLoadPolicy", () => {
  it("ends list loading without a full-chain request when the query is empty", () => {
    expect(auditListLoadPolicy(0)).toEqual({
      requestFullChainVerify: false,
      immediateChain: emptyAuditChainResult(),
    });
  });

  it("starts full-chain verify in the background when the query has rows", () => {
    expect(auditListLoadPolicy(3)).toEqual({
      requestFullChainVerify: true,
      immediateChain: null,
    });
  });
});
