import { NextResponse } from "next/server";
import { fetchFaviconBytes, normalizeFaviconHost } from "../../../../lib/web-search/favicon";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const host = new URL(request.url).searchParams.get("host") ?? "";
  if (!normalizeFaviconHost(host)) {
    return NextResponse.json({ error: { message: "invalid host" } }, { status: 400 });
  }

  const payload = await fetchFaviconBytes(host);
  if (!payload) {
    // Negative cache in browser briefly — source lists remount often and must not
    // re-stampede slow upstream favicon CDNs (was starving /api/chat/.../artifacts).
    return new NextResponse(null, {
      status: 404,
      headers: {
        "cache-control": "public, max-age=60, stale-while-revalidate=300",
      },
    });
  }

  return new NextResponse(Buffer.from(payload.bytes), {
    status: 200,
    headers: {
      "content-type": payload.contentType,
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
