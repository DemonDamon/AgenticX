import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import zh from "../../../messages/zh.json";
import { DreamReviewBanner } from "./DreamReviewBanner";

const review = zh.pages.admin.agentMemory.dream.review;

function html(value: string, confirming = false): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="zh" messages={zh} timeZone="Asia/Shanghai">
      <DreamReviewBanner review={value} confirming={confirming} onApprove={vi.fn()} onDiscard={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe("DreamReviewBanner", () => {
  it("shows the copy for each review state and buttons only while pending", () => {
    expect(html("running")).toContain(review.running);
    expect(html("running")).not.toContain(review.approve);

    const pending = html("pending");
    expect(pending).toContain(review.pending);
    expect(pending).toContain(review.approve);
    expect(pending).toContain(review.discard);
    expect(pending).not.toContain(review.discardDescription);

    expect(html("approved")).toContain(review.approved);
    expect(html("approved")).not.toContain(review.approve);
    expect(html("failed")).toContain(review.archived);
    expect(html("cancelled")).toContain(review.archived);
    expect(html("discarded")).toContain(review.archived);
    expect(html("failed")).not.toContain(review.discard);
  });

  it("opens the discard confirmation before archiving", () => {
    const confirming = html("pending", true);
    expect(confirming).toContain(review.discardDescription);
    expect(confirming).toContain('role="dialog"');
  });
});
