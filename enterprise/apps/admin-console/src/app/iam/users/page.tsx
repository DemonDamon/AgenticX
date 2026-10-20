import { redirect } from "next/navigation";

import { buildIamMembersRedirect } from "../../../lib/iam-members-redirects";

type SearchParams = Record<string, string | string[] | undefined>;

// Redirect legacy /iam/users to the organization and members page.
export default async function UsersRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = searchParams ? await searchParams : {};
  redirect(buildIamMembersRedirect("users", sp));
}
