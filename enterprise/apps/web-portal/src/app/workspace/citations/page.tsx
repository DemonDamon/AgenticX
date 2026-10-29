import Link from "next/link";
import { redirect } from "next/navigation";
import { CitationEvidencePanel, buildBrandACitationFixture } from "@agenticx/ui";
import { getWorkspaceSessionFromCookies } from "../../../lib/session";

/**
 * K1 citation UI demo — Brand-A fixture only (no live assemble_evidence).
 * Mount: /workspace/citations
 */
export default async function WorkspaceCitationsPage() {
  const result = await getWorkspaceSessionFromCookies();
  if (result.status === "unauthenticated") {
    redirect("/auth");
  }
  if (result.status === "password_change_required") {
    redirect("/auth/change-password");
  }

  const view = buildBrandACitationFixture();

  return (
    <main className="mx-auto max-w-[960px] space-y-4 p-6" data-testid="portal-citations-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Citation evidence</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            K1 view-model demo (Brand-A synthetic fixture). Contract: citation-ui-contract.md.
          </p>
        </div>
        <Link
          href="/workspace"
          className="text-sm text-primary underline-offset-4 hover:underline"
          data-testid="portal-citations-back"
        >
          Back to workspace
        </Link>
      </div>
      <CitationEvidencePanel view={view} title="Brand-A pump evidence" />
    </main>
  );
}
