import { redirect } from "next/navigation";

import { buildIamMembersRedirect } from "../../../lib/iam-members-redirects";

// Redirect legacy /iam/user-groups to the groups tab.
export default function UserGroupsRedirectPage() {
  redirect(buildIamMembersRedirect("user-groups"));
}
