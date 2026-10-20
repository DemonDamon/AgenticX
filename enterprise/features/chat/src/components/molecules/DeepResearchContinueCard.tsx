"use client";

import * as React from "react";
import type { ChatMessageDeepResearch } from "@agenticx/core-api";
import { Button } from "@agenticx/ui";

export function DeepResearchContinueCard({
  research,
  onContinue,
}: {
  research: ChatMessageDeepResearch;
  onContinue?: () => void;
}) {
  const resume = [...research.events].reverse().find((event) => event.type === "report_resume_available");
  if (!resume || (research.status !== "failed" && research.status !== "cancelled")) return null;
  return (
    <div className="my-3 rounded-xl border bg-background p-3 text-sm" data-testid="deep-research-continue">
      <p>{`已完成 ${resume.completedSections} / ${resume.totalSections} 章`}</p>
      {onContinue ? (
        <>
          <Button type="button" size="sm" className="mt-3" onClick={onContinue}>
            继续完成报告
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">继续写作仍受使用上限与内容策略限制</p>
        </>
      ) : null}
    </div>
  );
}
