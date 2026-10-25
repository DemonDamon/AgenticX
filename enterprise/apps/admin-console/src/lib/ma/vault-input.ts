import { NextResponse } from "next/server";

import { MaRequestError } from "./http";

export function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "no-store");
  return response;
}

export function readIncludeArchived(url: URL): boolean {
  return url.searchParams.get("include_archived") === "true";
}

export function readStringList(value: unknown, label: string, max: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max || value.some((item) => typeof item !== "string")) {
    throw new MaRequestError(`${label} must contain 1 to ${max} strings`);
  }
  return value;
}
