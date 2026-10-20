export type IamLegacySurface = "index" | "users" | "departments" | "user-groups" | "bulk-import";

type SearchValue = string | string[] | undefined;

function first(value: SearchValue): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value || undefined;
}

/** Map a retired IAM route onto the organization & members page. */
export function buildIamMembersRedirect(
  surface: IamLegacySurface,
  searchParams: Record<string, SearchValue> = {},
): string {
  const params = new URLSearchParams();
  if (surface === "user-groups") {
    params.set("tab", "groups");
  } else if (surface === "bulk-import") {
    params.set("import", "1");
  } else if (surface === "departments") {
    params.set("org", "1");
    const dept = first(searchParams.dept);
    if (dept) params.set("dept", dept);
  } else if (surface === "users") {
    const dept = first(searchParams.dept);
    const user = first(searchParams.user) || first(searchParams.userId);
    const create = first(searchParams.create);
    if (dept) params.set("dept", dept);
    if (user) params.set("user", user);
    if (create) params.set("create", create);
  }
  const qs = params.toString();
  return qs ? `/iam/members?${qs}` : "/iam/members";
}
