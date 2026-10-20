import { redirect } from "next/navigation";

import { buildIamMembersRedirect } from "../../../lib/iam-members-redirects";

type SearchParams = Record<string, string | string[] | undefined>;

// Redirect legacy /iam/departments to the organization editor.
export default async function DepartmentsRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = searchParams ? await searchParams : {};
  redirect(buildIamMembersRedirect("departments", sp));
}
