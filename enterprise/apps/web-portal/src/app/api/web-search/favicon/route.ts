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
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(Buffer.from(payload.bytes), {
    status: 200,
    headers: {
      "content-type": payload.contentType,
      // Short cache: a prior bug served UTF-8-corrupted bytes with max-age=86400;
      // avoid sticky broken icons in the browser disk cache.
      "cache-control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
