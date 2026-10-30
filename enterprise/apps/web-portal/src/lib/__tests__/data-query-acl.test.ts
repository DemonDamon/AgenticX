import { describe, expect, it } from "vitest";
import { QueryAccessDenied, SAMPLE_QUERY_ROWS, secureQueryRows } from "../data-query-acl";

describe("portal data-query-acl", () => {
  it("masks analyst and denies outsider", () => {
    const out = secureQueryRows(SAMPLE_QUERY_ROWS, { role: "analyst", datasetId: "members" });
    expect(out[0]?.phone).toBe("1*********8");
    expect(() =>
      secureQueryRows(SAMPLE_QUERY_ROWS, { role: "outsider", datasetId: "members" }),
    ).toThrow(QueryAccessDenied);
  });
});
