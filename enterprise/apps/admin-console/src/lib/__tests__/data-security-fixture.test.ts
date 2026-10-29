import { describe, expect, it } from "vitest";
import { SAMPLE_MASKING_POLICY, SAMPLE_SECURITY_ROWS, maskRows } from "../data-security-fixture";

describe("data-security-fixture", () => {
  it("masks analyst phone partially", () => {
    const out = maskRows(SAMPLE_SECURITY_ROWS, "analyst");
    const row = out[0];
    expect(row).toBeDefined();
    expect(row?.phone).toBe("1*********8");
    expect(row?.email).toBe("a***************m");
  });

  it("keeps admin full", () => {
    const out = maskRows(SAMPLE_SECURITY_ROWS, "admin");
    const row = out[0];
    expect(row).toBeDefined();
    expect(row?.phone).toBe("13812345678");
  });

  it("exposes policy id", () => {
    expect(SAMPLE_MASKING_POLICY.id).toBe("sample_masking");
  });
});
