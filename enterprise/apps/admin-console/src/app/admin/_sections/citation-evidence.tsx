"use client";

import { CitationEvidencePanel, buildBrandACitationFixture } from "@agenticx/ui";

/** K1 citation UI — admin reuse of shared CitationEvidencePanel + Brand-A fixture. */
export default function CitationEvidenceSection() {
  const view = buildBrandACitationFixture();
  return (
    <div className="space-y-4" data-testid="citation-evidence-admin-page">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Citation evidence</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Shared K1 view-model panel (Brand-A synthetic fixture).
        </p>
      </div>
      <CitationEvidencePanel view={view} title="Brand-A pump evidence" />
    </div>
  );
}
