import { describe, expect, it, vi } from "vitest";

vi.mock("../roles", () => ({
  listRoles: vi.fn(async () => [
    { code: "member", scopes: ["workspace:chat"] },
    { code: "super_admin", scopes: ["*"] },
    { code: "operator", scopes: ["ma:agents:read"] },
  ]),
  getUserRolesDetail: vi.fn(async (_tenant: string, id: string) => ({ scopes: id === "owner" ? ["*"] : ["workspace:chat"], roleCodes: [] })),
}));

import { expandRoleScopes, mergeUserScopes } from "../../scope-registry";
import { assertActorHasScope, assertActorMayGrantRoles, assertActorMayGrantScopes, assertActorMayManageUser, type AdministrativeActor } from "../privilege-guard";

const actor: AdministrativeActor = { kind: "user", tenantId: "tenant", userId: "admin", scopes: ["role:manage", "workspace:chat", "ma:agents:read"] };

describe("administrative grant boundaries", () => {
  it("requires an explicit same-tenant actor", () => {
    expect(() => assertActorMayGrantScopes(undefined, "tenant", [])).toThrow(/explicit/);
    expect(() => assertActorMayGrantScopes(actor, "other", [])).toThrow(/same-tenant/);
    expect(() => assertActorMayGrantScopes({ kind: "system", tenantId: "other", purpose: "sso" }, "tenant", [])).toThrow();
  });
  it("does not turn role management into unrestricted delegation", () => {
    expect(() => assertActorMayGrantScopes(actor, "tenant", ["*"])).toThrow();
    expect(() => assertActorMayGrantScopes(actor, "tenant", ["unregistered:privileged"])).toThrow();
    expect(() => assertActorMayGrantScopes(actor, "tenant", ["ma:agents:read"])).not.toThrow();
  });
  it("rejects unknown and excessive roles while retaining legitimate grants", async () => {
    await expect(assertActorMayGrantRoles("tenant", actor, ["super_admin"])).rejects.toThrow();
    await expect(assertActorMayGrantRoles("tenant", actor, ["missing"])).rejects.toThrow(/unknown/);
    await expect(assertActorMayGrantRoles("tenant", actor, ["member", "operator"])).resolves.toBeUndefined();
  });
  it("checks existing target privileges before management", async () => {
    await expect(assertActorMayManageUser("tenant", actor, "owner")).rejects.toThrow();
    await expect(assertActorMayManageUser("tenant", actor, "member")).resolves.toBeUndefined();
  });
  it("allows only an explicit system purpose to bypass the grant ceiling", () => {
    expect(() => assertActorMayGrantScopes({ kind: "system", tenantId: "tenant", purpose: "sso" }, "tenant", ["*"])).not.toThrow();
    expect(() => assertActorHasScope(actor, "tenant", "user:create")).toThrow();
  });
  it("preserves wildcard identity and managed-agent permissions during aggregation", () => {
    expect(expandRoleScopes(["*"])).toContain("*");
    expect(mergeUserScopes([["ma:agents:read"], ["workspace:chat"]])).toEqual(["ma:agents:read", "workspace:chat"]);
  });
});
