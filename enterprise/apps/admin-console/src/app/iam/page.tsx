import { redirect } from "next/navigation";

import { buildIamMembersRedirect } from "../../lib/iam-members-redirects";

// Legacy index. Previously this sent browsers to /iam/users.
export default function IamPage() {
  redirect(buildIamMembersRedirect("index"));
}
