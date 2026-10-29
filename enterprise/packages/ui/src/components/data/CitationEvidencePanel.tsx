"use client";

import * as React from "react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { cn } from "../../lib/cn";
import {
  formatConfidence,
  type CitationView,
} from "./citation-view";

export type CitationEvidencePanelProps = {
  view: CitationView;
  className?: string;
  title?: string;
  testId?: string;
};

/**
 * Shared citation / conflict / missing panel for portal + admin.
 * Binds to citation-ui-contract.md view-model only.
 */
export function CitationEvidencePanel({
  view,
  className,
  title = "Evidence citations",
  testId = "citation-evidence-panel",
}: CitationEvidencePanelProps): React.ReactElement {
  return (
    <div className={cn("space-y-4", className)} data-testid={testId} data-entity-id={view.entity_id}>
      <Card data-testid="citation-evidence-summary-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div data-testid="citation-evidence-entity">
            <span className="text-muted-foreground">entity_id: </span>
            <span className="font-mono text-xs">{view.entity_id}</span>
          </div>
          {view.summary ? (
            <p className="text-muted-foreground" data-testid="citation-evidence-summary">
              {view.summary}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card data-testid="citation-evidence-citations-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Citations{" "}
            <Badge variant="secondary" data-testid="citation-evidence-citations-count">
              {view.citations.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {view.citations.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="citation-evidence-citations-empty">
              No citations
            </p>
          ) : (
            <ul className="space-y-3" data-testid="citation-evidence-citations-list">
              {view.citations.map((c, idx) => (
                <li
                  key={`${c.source_id}-${c.kind}-${idx}`}
                  className="rounded-md border border-border/70 bg-muted/20 p-3"
                  data-testid={`citation-evidence-item-${idx}`}
                  title={`${c.source_id} · conf=${c.confidence ?? "n/a"}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{c.label}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {c.kind}
                    </Badge>
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {c.source_type}
                    </Badge>
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                      {formatConfidence(c.confidence)}
                    </span>
                  </div>
                  {c.excerpt ? (
                    <p className="mt-2 text-sm leading-relaxed text-foreground/90">{c.excerpt}</p>
                  ) : null}
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {c.source_id}
                    {c.context_ptr ? ` · ${c.context_ptr}` : ""}
                    {c.data_time ? ` · ${c.data_time}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {view.conflicts.length > 0 ? (
        <Alert variant="warning" data-testid="citation-evidence-conflicts">
          <AlertTitle>
            Conflicts{" "}
            <span className="font-mono text-xs">({view.conflicts.length})</span>
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-2 space-y-3">
              {view.conflicts.map((conflict, i) => (
                <li key={`${conflict.identity}-${i}`} data-testid={`citation-evidence-conflict-${i}`}>
                  <div className="font-mono text-xs font-semibold text-foreground">
                    {conflict.identity}
                    {conflict.kind ? ` · ${conflict.kind}` : ""}
                  </div>
                  <ul className="mt-1 space-y-1">
                    {conflict.values.map((v, j) => (
                      <li key={`${conflict.identity}-${j}`} className="font-mono text-xs">
                        {String(v.value)} ← {v.source_id} ({v.source_type},{" "}
                        {formatConfidence(v.confidence)})
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {view.missing.length > 0 ? (
        <Alert variant="info" data-testid="citation-evidence-missing">
          <AlertTitle>Missing evidence (soft hint)</AlertTitle>
          <AlertDescription>
            <ul className="mt-2 flex flex-wrap gap-2">
              {view.missing.map((m) => (
                <li key={m}>
                  <Badge variant="outline" className="font-mono text-[11px]" data-testid={`citation-evidence-missing-${m}`}>
                    {m}
                  </Badge>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

export default CitationEvidencePanel;
