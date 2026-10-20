import { describe, expect, it } from "vitest";
import { buildIamMembersRedirect } from "../iam-members-redirects";

describe("retired IAM routes land on organization and members", () => {
  it("users?dept&user keeps both params", () => {
    expect(buildIamMembersRedirect("users", { dept: "d1", user: "u1" })).toBe(
      "/iam/members?dept=d1&user=u1",
    );
  });

  it("users?userId is renamed to user", () => {
    expect(buildIamMembersRedirect("users", { userId: "u1" })).toBe("/iam/members?user=u1");
  });

  it("users prefers user over userId and keeps create", () => {
    expect(buildIamMembersRedirect("users", { user: "u1", userId: "other", create: "1" })).toBe(
      "/iam/members?user=u1&create=1",
    );
  });

  it("user-groups opens the groups tab", () => {
    expect(buildIamMembersRedirect("user-groups")).toBe("/iam/members?tab=groups");
  });

  it("bulk-import opens the import dialog", () => {
    expect(buildIamMembersRedirect("bulk-import")).toBe("/iam/members?import=1");
  });

  it("departments opens the organization editor", () => {
    expect(buildIamMembersRedirect("departments")).toBe("/iam/members?org=1");
  });

  it("departments keeps a dept param", () => {
    expect(buildIamMembersRedirect("departments", { dept: "d1" })).toBe("/iam/members?org=1&dept=d1");
  });

  it("the IAM index goes to members with no query", () => {
    expect(buildIamMembersRedirect("index", { dept: "d1" })).toBe("/iam/members");
  });
});
