import { redirect } from "next/navigation";

type LegacyUsersSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

/**
 * The old user detail drawer is intentionally retired. Keep this route only as
 * a compatibility bridge for bookmarks and older organization links, and send
 * every entry point to the current inline user-management page.
 */
export default async function LegacyUsersPage({
  searchParams,
}: {
  searchParams: Promise<LegacyUsersSearchParams>;
}) {
  const legacy = await searchParams;
  const next = new URLSearchParams();
  const userId = firstValue(legacy.user) || firstValue(legacy.userId);
  const deptId = firstValue(legacy.dept);

  if (userId) {
    next.set("user", userId);
    next.set("edit", "1");
  }
  if (deptId) next.set("dept", deptId);
  if (firstValue(legacy.create) === "1") next.set("create", "1");

  const query = next.toString();
  redirect(query ? `/iam/roles?${query}` : "/iam/roles");
}
