import { describe, expect, it } from "vitest";
import { executeCalculatorBatch, executeCalculatorRequest } from "./core";

describe("deterministic calculator", () => {
  it("adds decimal values without binary floating-point drift", () => {
    expect(
      executeCalculatorRequest({
        id: "sum",
        operation: "sum",
        operands: ["0.1", "0.2"],
      }),
    ).toMatchObject({
      status: "ok",
      value: "0.3",
      displayValue: "0.3",
      precision: "exact_decimal",
    });
  });

  it("keeps large and small magnitudes out of exponential notation", () => {
    expect(
      executeCalculatorRequest({
        id: "large",
        operation: "sum",
        operands: ["99999999999999999999", "1"],
      }).value,
    ).toBe("100000000000000000000");
    expect(
      executeCalculatorRequest({
        id: "small",
        operation: "product",
        operands: ["0.0000001", "0.1"],
      }).value,
    ).toBe("0.00000001");
  });

  it("handles the two common percentage operations with explicit operand order", () => {
    expect(
      executeCalculatorRequest({
        id: "part",
        operation: "percent_of",
        operands: ["12.5", "800"],
      }),
    ).toMatchObject({ status: "ok", value: "100", displayValue: "100" });
    expect(
      executeCalculatorRequest({
        id: "growth",
        operation: "percentage_change",
        operands: ["1200", "1400"],
      }),
    ).toMatchObject({
      status: "ok",
      displayValue: "16.6666666666667%",
      precision: "approximate",
    });
  });

  it("bounds recurring decimals and rejects undefined division without throwing", () => {
    expect(
      executeCalculatorRequest({
        id: "third",
        operation: "quotient",
        operands: ["1", "3"],
      }),
    ).toMatchObject({
      status: "ok",
      value: "0.333333333333333",
      displayValue: "0.333333333333333",
      precision: "approximate",
    });
    expect(
      executeCalculatorRequest({
        id: "zero",
        operation: "quotient",
        operands: ["1", "0"],
      }),
    ).toMatchObject({ status: "rejected", error: "division by zero" });
    expect(
      executeCalculatorRequest({
        id: "growth-zero",
        operation: "percentage_change",
        operands: ["0", "1"],
      }),
    ).toMatchObject({ status: "rejected", error: "percentage change from zero is undefined" });
  });

  it("accepts grouped strings but rejects unsafe JSON integer operands", () => {
    expect(
      executeCalculatorBatch({
        calculations: [{ operation: "difference", operands: ["1,400", "1,200"] }],
      })[0],
    ).toMatchObject({ status: "ok", value: "200" });
    expect(
      executeCalculatorBatch({
        calculations: [{ operation: "sum", operands: [Number.MAX_SAFE_INTEGER + 1, 1] }],
      })[0],
    ).toMatchObject({ status: "rejected" });
  });

  it("fails closed for malformed batches and unknown operations", () => {
    expect(executeCalculatorBatch(null)).toEqual([]);
    expect(executeCalculatorBatch({ calculations: "not-an-array" })).toEqual([]);
    expect(
      executeCalculatorBatch({
        calculations: [{ operation: "eval", operands: ["1", "2"], code: "1+2" }],
      })[0],
    ).toMatchObject({ status: "rejected", operation: "unknown" });
    expect(
      executeCalculatorBatch({
        calculations: Array.from({ length: 9 }, () => ({
          operation: "sum",
          operands: ["1", "2"],
        })),
      }),
    ).toEqual([]);
  });
});
