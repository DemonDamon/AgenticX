import { NextResponse } from "next/server";
import { ProjectForbiddenError, ProjectNotFoundError } from "@agenticx/iam-core";

export function projectErrorResponse(error: unknown) {
  if (error instanceof ProjectForbiddenError) {
    return NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 });
  }
  if (error instanceof ProjectNotFoundError) {
    return NextResponse.json({ code: "40400", message: "not found" }, { status: 404 });
  }
  return NextResponse.json({ code: "50000", message: "failed" }, { status: 500 });
}

function positiveInt(raw: string | null, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

export function readProjectListQuery(url: URL): { q?: string; limit: number; offset: number } {
  const q = url.searchParams.get("q")?.trim() ?? "";
  const page = positiveInt(url.searchParams.get("page"), 1);
  const pageSize = Math.min(100, positiveInt(url.searchParams.get("page_size"), 20));
  return {
    ...(q ? { q } : {}),
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
}

export function readMessageQuery(
  url: URL,
): { afterSeq?: number; limit: number } | { error: "invalid after_seq" | "invalid limit" } {
  const afterRaw = url.searchParams.get("after_seq");
  let afterSeq: number | undefined;
  if (afterRaw != null && afterRaw !== "") {
    const parsed = Number(afterRaw);
    if (!Number.isInteger(parsed) || parsed < 0) return { error: "invalid after_seq" };
    afterSeq = parsed;
  }
  const limitRaw = url.searchParams.get("limit");
  let limit = 50;
  if (limitRaw != null && limitRaw !== "") {
    const parsed = Number(limitRaw);
    if (!Number.isInteger(parsed) || parsed < 1) return { error: "invalid limit" };
    limit = Math.min(parsed, 200);
  }
  return { ...(afterSeq != null ? { afterSeq } : {}), limit };
}
