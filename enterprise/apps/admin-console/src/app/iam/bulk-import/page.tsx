import { redirect } from "next/navigation";

import { buildIamMembersRedirect } from "../../../lib/iam-members-redirects";

// Redirect legacy /iam/bulk-import to the import dialog.
export default function BulkImportRedirectPage() {
  redirect(buildIamMembersRedirect("bulk-import"));
}
