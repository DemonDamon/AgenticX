import { describe, expect, it } from "vitest";
import {
  QueryAccessDenied,
  SAMPLE_QUERY_ACL,
  SAMPLE_QUERY_ROWS,
  checkQueryAccess,
  secureQueryRows,
} from "../data-query-acl";

describe("data-query-acl", () => {
  it("denies outsider role", () => {
    const d = checkQueryAccess(SAMPLE_QUERY_ACL, { role: "outsider", datasetId: "members" });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("role_not_granted");
  });

  it("allows analyst on members and masks phone", () => {
    const out = secureQueryRows(SAMPLE_QUERY_ROWS, {
      role: "analyst",
      datasetId: "members",
      boardId: "sample_member_board",
    });
    expect(out[0]?.phone).toBe("1*********8");
    expect(out[0]?.phone).not.toBe(SAMPLE_QUERY_ROWS[0]?.phone);
  });

  it("guest drops confidential phone", () => {
    const out = secureQueryRows(SAMPLE_QUERY_ROWS, {
      role: "guest",
      datasetId: "members",
    });
    expect(out[0]?.phone).toBeNull();
  });

  it("throws QueryAccessDenied for payroll dataset as analyst", () => {
    expect(() =>
      secureQueryRows(SAMPLE_QUERY_ROWS, { role: "analyst", datasetId: "payroll" }),
    ).toThrow(QueryAccessDenied);
  });

  it("admin sees full phone", () => {
    const out = secureQueryRows(SAMPLE_QUERY_ROWS, {
      role: "admin",
      datasetId: "members",
    });
    expect(out[0]?.phone).toBe("13812345678");
  });
});
