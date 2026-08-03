/**
 * Deep-research export: HTML / Markdown / Word-compatible .doc
 * Kept for direct/API download; chat UI uses artifact cards + files panel.
 */

import { NextResponse } from "next/server";
import { getSessionFromCookies } from "../../../../../../../lib/session";
import { defaultArtifactStore } from "../../../../../../../lib/deep-research/artifact-store";
import {
  renderWordHtmlDocument,
  safeFilename,
} from "../../../../../../../lib/deep-research/finalize-report-artifacts";
import { markdownToHtml } from "../../../../../../../lib/deep-research/report-html";
import type { ArtifactRecord } from "../../../../../../../lib/deep-research/artifact-store";

export const runtime = "nodejs";

type Params = Promise<{ runId: string }>;

function pickArtifact(
  artifacts: ArtifactRecord[],
  candidates: string[],
): ArtifactRecord | null {
  for (const suffix of candidates) {
    const hit = artifacts.find((a) => a.path.endsWith(suffix) || a.path === suffix);
    if (hit) return hit;
  }
  return null;
}

function attachmentHeaders(filename: string, contentType: string): HeadersInit {
  const encoded = encodeURIComponent(filename);
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encoded}`,
    "Cache-Control": "private, no-store",
  };
}

export async function GET(request: Request, segmentData: { params: Params }) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json(
      { error: { code: "40101", message: "unauthorized" } },
      { status: 401 },
    );
  }

  const { runId: rawRunId } = await segmentData.params;
  const runId = typeof rawRunId === "string" ? rawRunId.trim() : "";
  if (!runId) {
    return NextResponse.json(
      { error: { code: "40001", message: "runId required" } },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "").trim().toLowerCase();
  if (format !== "html" && format !== "md" && format !== "docx") {
    return NextResponse.json(
      { error: { code: "40001", message: "unsupported format; use html|md|docx" } },
      { status: 400 },
    );
  }

  const artifacts = await defaultArtifactStore.listByRun(
    session.tenantId,
    session.userId,
    runId,
  );
  // Cross-tenant / cross-user: listByRun already scopes; empty → 404 (no leak).
  if (artifacts.length === 0) {
    return NextResponse.json(
      { error: { code: "40401", message: "run not found" } },
      { status: 404 },
    );
  }

  const titleHint =
    artifacts.find((a) => a.path.endsWith("final-report.md") || a.path.endsWith("report.md"))
      ?.title ??
    artifacts[0]?.title ??
    "调研报告";

  if (format === "html") {
    const htmlArt = pickArtifact(artifacts, [
      `research/${runId}/report.html`,
      "/report.html",
      "report.html",
    ]);
    if (!htmlArt?.content) {
      return NextResponse.json(
        { error: { code: "40401", message: "html report not found" } },
        { status: 404 },
      );
    }
    const inline = url.searchParams.get("inline") === "1";
    const filename = safeFilename(titleHint.replace(/·.*$/, "").trim() || "调研报告", "html");
    if (inline) {
      return new NextResponse(htmlArt.content, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, no-store",
        },
      });
    }
    return new NextResponse(htmlArt.content, {
      status: 200,
      headers: attachmentHeaders(filename, "text/html; charset=utf-8"),
    });
  }

  if (format === "md") {
    const mdArt = pickArtifact(artifacts, [
      `research/${runId}/report.md`,
      `research/${runId}/final-report.md`,
      "/report.md",
      "/final-report.md",
      "report.md",
      "final-report.md",
    ]);
    if (!mdArt?.content) {
      return NextResponse.json(
        { error: { code: "40401", message: "markdown report not found" } },
        { status: 404 },
      );
    }
    const filename = safeFilename(titleHint.replace(/·.*$/, "").trim() || "调研报告", "md");
    return new NextResponse(mdArt.content, {
      status: 200,
      headers: attachmentHeaders(filename, "text/markdown; charset=utf-8"),
    });
  }

  // docx → Word-compatible HTML with .doc disposition (zero npm deps).
  const mdArt = pickArtifact(artifacts, [
    `research/${runId}/report.md`,
    `research/${runId}/final-report.md`,
    "report.md",
    "final-report.md",
  ]);
  const htmlArt = pickArtifact(artifacts, [
    `research/${runId}/report.html`,
    "report.html",
  ]);
  let bodyHtml = "";
  if (mdArt?.content) {
    bodyHtml = markdownToHtml(mdArt.content).html;
  } else if (htmlArt?.content) {
    // Fallback: strip to article body if present, else full document.
    const match = htmlArt.content.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    bodyHtml = match?.[1] ?? htmlArt.content;
  } else {
    return NextResponse.json(
      { error: { code: "40401", message: "report not found" } },
      { status: 404 },
    );
  }
  const docTitle = titleHint.replace(/·.*$/, "").trim() || "调研报告";
  const doc = renderWordHtmlDocument(docTitle, bodyHtml);
  const filename = safeFilename(docTitle, "doc");
  return new NextResponse(doc, {
    status: 200,
    headers: attachmentHeaders(
      filename,
      "application/vnd.ms-word; charset=utf-8",
    ),
  });
}
