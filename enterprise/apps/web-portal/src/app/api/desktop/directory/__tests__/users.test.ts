import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();
const listAdminUsers = vi.fn();
const listDepartmentsFlat = vi.fn();

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("@agenticx/iam-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agenticx/iam-core")>();
  return {
    ...actual,
    listAdminUsers: (...args: unknown[]) => listAdminUsers(...args),
    listDepartmentsFlat: (...args: unknown[]) => listDepartmentsFlat(...args),
  };
});

import { GET } from "../users/route";

const IDENTITY = {
  userId: "01HZX3NDEKTSV4RRFFQ69G5FAV",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  deptId: "01DEPT0AAAAAAAAAAAAAAAAAAA",
  email: "bob@example.com",
  displayName: "Bob",
  tokenId: 42,
  scopes: ["workspace:chat", "desktop:managed"],
};

const ALICE = "01PEER0AAAAAAAAAAAAAAAAAAA";
const DISABLED = "01DISAB1ED0000000000000000";

function person(input: {
  id: string;
  displayName: string;
  email: string;
  status: "active" | "disabled" | "locked";
  deptId: string | null;
}) {
  return {
    tenantId: IDENTITY.tenantId,
    scopes: [] as string[],
    roleCodes: [] as string[],
    phone: null,
    employeeNo: null,
    jobTitle: null,
    createdAt: "2026-10-19T00:00:00.000Z",
    updatedAt: "2026-10-19T00:00:00.000Z",
    ...input,
  };
}

describe("GET /api/desktop/directory/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveDesktopIdentity.mockResolvedValue(IDENTITY);
    listDepartmentsFlat.mockResolvedValue([
      {
        id: IDENTITY.deptId,
        tenantId: IDENTITY.tenantId,
        orgId: "01ORG00000000000000000000A",
        parentId: null,
        name: "研发部",
        path: "/研发部",
        createdAt: "2026-10-19T00:00:00.000Z",
        updatedAt: "2026-10-19T00:00:00.000Z",
      },
    ]);
  });

  it("returns 401 without a PAT", async () => {
    resolveDesktopIdentity.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost/api/desktop/directory/users"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "40101" });
    expect(listAdminUsers).not.toHaveBeenCalled();
  });

  it("lists the caller's department and drops disabled users when q is empty", async () => {
    listAdminUsers.mockResolvedValueOnce({
      items: [
        person({
          id: ALICE,
          displayName: "Alice",
          email: "alice@example.com",
          status: "active",
          deptId: IDENTITY.deptId,
        }),
        person({
          id: DISABLED,
          displayName: "Gone",
          email: "gone@example.com",
          status: "disabled",
          deptId: IDENTITY.deptId,
        }),
        person({
          id: IDENTITY.userId,
          displayName: "Bob",
          email: "bob@example.com",
          status: "locked",
          deptId: null,
        }),
      ],
      total: 3,
    });
    const res = await GET(new Request("http://localhost/api/desktop/directory/users"));
    expect(res.status).toBe(200);
    expect(listAdminUsers).toHaveBeenCalledWith(IDENTITY.tenantId, {
      limit: 20,
      deptId: IDENTITY.deptId,
      deptScope: "direct",
    });
    const body = (await res.json()) as {
      code: string;
      data: { users: Array<{ id: string; display_name: string; email: string; dept_name: string }> };
    };
    expect(body.code).toBe("00000");
    expect(body.data.users).toEqual([
      { id: ALICE, display_name: "Alice", email: "alice@example.com", dept_name: "研发部" },
      { id: IDENTITY.userId, display_name: "Bob", email: "bob@example.com", dept_name: "" },
    ]);
  });

  it("searches by q and caps limit at 20", async () => {
    listAdminUsers.mockResolvedValueOnce({ items: [], total: 0 });
    const res = await GET(new Request("http://localhost/api/desktop/directory/users?q=%20ali%20&limit=50"));
    expect(res.status).toBe(200);
    expect(listAdminUsers).toHaveBeenCalledWith(IDENTITY.tenantId, { limit: 20, q: "ali" });
  });

  it("honors a limit below 20", async () => {
    listAdminUsers.mockResolvedValueOnce({ items: [], total: 0 });
    const res = await GET(new Request("http://localhost/api/desktop/directory/users?q=a&limit=5"));
    expect(res.status).toBe(200);
    expect(listAdminUsers).toHaveBeenCalledWith(IDENTITY.tenantId, { limit: 5, q: "a" });
  });
});
