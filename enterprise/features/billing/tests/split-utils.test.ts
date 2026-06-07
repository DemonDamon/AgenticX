import { describe, expect, it } from "vitest";
import { costUsdToMicro, microToUsd, reconcileRowsToCsv, splitAmountMicro } from "../src/services/split-utils";

describe("splitAmountMicro", () => {
  it("splits 70/30 and sums to original cost (AC-1)", () => {
    const total = costUsdToMicro(10);
    const shares = splitAmountMicro(total, [
      { participant_id: "platform", ratio_bps: 7000 },
      { participant_id: "provider", ratio_bps: 3000 },
    ]);
    expect(shares).toHaveLength(2);
    const sum = shares.reduce((acc, item) => acc + item.amount_micro, 0n);
    expect(sum).toBe(total);
    expect(shares[0]?.amount_micro).toBe(7000000n);
    expect(shares[1]?.amount_micro).toBe(3000000n);
  });

  it("returns empty shares for zero total (AC-3)", () => {
    expect(splitAmountMicro(0n, [{ participant_id: "a", ratio_bps: 5000 }])).toEqual([]);
  });
});

describe("reconcileRowsToCsv", () => {
  it("exports participant summary (AC-2)", () => {
    const csv = reconcileRowsToCsv([
      { participant_id: "platform", participant_label: "平台", amount_micro_usd: "7000000", entry_count: 2 },
    ]);
    expect(csv.split("\n")[0]).toBe("participant_id,participant_label,amount_usd,entry_count");
    expect(csv).toContain("platform");
    expect(csv).toContain("7.00000000");
  });
});

describe("costUsdToMicro", () => {
  it("rounds to integer micro units", () => {
    expect(costUsdToMicro(1.234567)).toBe(1234567n);
    expect(microToUsd(1234567n)).toBeCloseTo(1.234567);
  });
});
