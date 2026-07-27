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
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
