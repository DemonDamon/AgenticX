import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getSessionFromCookies } from "../../../../../lib/session";
import { defaultOriginalStore } from "../../../../../lib/attachments/original-store";

export const runtime = "nodejs";

type Params = Promise<{ id: string }>;

const FORCE_DOWNLOAD_MIME = new Set(["text/html", "image/svg+xml", "application/xhtml+xml"]);

function contentDisposition(fileName: string, asAttachment: boolean): string {
  const disposition = asAttachment ? "attachment" : "inline";
  const encoded = encodeURIComponent(fileName).replace(/['()]/g, escape);
  return `${disposition}; filename*=UTF-8''${encoded}`;
}

export async function GET(request: Request, segmentData: { params: Params }) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: { code: "40101", message: "unauthorized" } }, { status: 401 });
  }
  const { id } = await segmentData.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: { code: "40001", message: "missing attachment id" } }, { status: 400 });
  }

  const record = await defaultOriginalStore.getMeta(session.tenantId, session.userId, id);
  if (!record) {
    return NextResponse.json({ error: { code: "40401", message: "attachment not found" } }, { status: 404 });
  }

  const url = new URL(request.url);
  const forceDownload = url.searchParams.get("download") === "1";
  const dangerous = FORCE_DOWNLOAD_MIME.has(record.mimeType.toLowerCase());
  const asAttachment = forceDownload || dangerous;
  const contentType = dangerous ? "application/octet-stream" : record.mimeType;

  let nodeStream: Readable;
  try {
    nodeStream = await defaultOriginalStore.openStream(record);
  } catch {
    return NextResponse.json({ error: { code: "40401", message: "attachment blob missing" } }, { status: 404 });
  }

  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(record.byteSize),
      "Content-Disposition": contentDisposition(record.fileName, asAttachment),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
