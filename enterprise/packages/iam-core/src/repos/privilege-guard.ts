import { hasEveryScope } from "../scope-registry";
import { getUserRolesDetail, listRoles } from "./roles";
import { getDepartment } from "./departments";

export type AdministrativeActor =
  | { kind: "user"; tenantId: string; userId: string; scopes: string[] }
  | { kind: "system"; tenantId: string; purpose: "bootstrap" | "sso" | "provisioning" };

export class PrivilegeEscalationError extends Error {
  constructor(message = "forbidden: target privileges exceed your own") {
    super(message);
    this.name = "PrivilegeEscalationError";
  }
}

export function assertAdministrativeActor(
  actor: AdministrativeActor | undefined,
  tenantId: string,
): asserts actor is AdministrativeActor {
  if (!actor || actor.tenantId !== tenantId ||
      (actor.kind !== "system" && actor.kind !== "user") ||
      (actor.kind === "user" && (!actor.userId || !Array.isArray(actor.scopes))) ||
      (actor.kind === "system" && !["bootstrap", "sso", "provisioning"].includes(actor.purpose))) {
    throw new PrivilegeEscalationError("forbidden: explicit same-tenant actor required");
  }
}

export function assertActorHasScope(actor: AdministrativeActor | undefined, tenantId: string, scope: string): void {
  assertAdministrativeActor(actor, tenantId);
  if (actor.kind !== "system" && !hasEveryScope(actor.scopes, [scope])) {
    throw new PrivilegeEscalationError("forbidden: administrative capability required");
  }
}

/** Compare the actual target strings; never drop an unknown target permission. */
export function assertActorMayGrantScopes(
  actor: AdministrativeActor | undefined,
  tenantId: string,
  targetScopes: readonly string[],
): void {
  assertAdministrativeActor(actor, tenantId);
  if (actor.kind === "system") return;
  const own = new Set(actor.scopes);
  if (!own.has("*") && targetScopes.some((scope) => typeof scope !== "string" || !own.has(scope))) {
    throw new PrivilegeEscalationError();
  }
}

export async function assertActorMayGrantRoles(
  tenantId: string,
  actor: AdministrativeActor | undefined,
  roleCodes: string[],
): Promise<void> {
  assertAdministrativeActor(actor, tenantId);
  const wanted = [...new Set(roleCodes.map((code) => code.trim()).filter(Boolean))];
  const all = await listRoles(tenantId);
  for (const code of wanted) {
    const role = all.find((item) => item.code === code);
    if (!role) throw new Error("unknown role code");
    assertActorMayGrantScopes(actor, tenantId, role.scopes);
  }
}

export async function assertActorMayManageUser(
  tenantId: string,
  actor: AdministrativeActor | undefined,
  userId: string,
): Promise<void> {
  assertAdministrativeActor(actor, tenantId);
  const { scopes } = await getUserRolesDetail(tenantId, userId);
  assertActorMayGrantScopes(actor, tenantId, scopes);
}

/** A department ID is not globally authoritative: it must belong to this tenant. */
export async function assertDepartmentBelongsToTenant(tenantId: string, deptId: string | null | undefined): Promise<void> {
  if (deptId == null) return;
  if (typeof deptId !== "string" || !deptId.trim() || !(await getDepartment(tenantId, deptId))) {
    throw new PrivilegeEscalationError("forbidden: department must belong to the account tenant");
  }
}
