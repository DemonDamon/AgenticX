import { NextResponse } from "next/server";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../../lib/session";
import { parseAttachmentFile, MAX_PARSE_FILE_BYTES } from "../../../../../lib/attachment-parse";
import {
  defaultOriginalStore,
  MAX_ORIGINAL_RETAIN_BYTES,
} from "../../../../../lib/attachments/original-store";

export const runtime = "nodejs";

const MAX_FILES_PER_REQUEST = 10;
const PARSE_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`解析超时（${Math.round(ms / 1000)}s）：${label}`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function POST(request: Request) {
  const session = await getSessionFromCookies();
  if (session?.mustChangePassword) {
    return passwordChangeRequiredResponse();
  }
  if (!session) {
    return NextResponse.json({ error: { code: "40101", message: "unauthorized" } }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: { code: "40001", message: "invalid multipart body" } }, { status: 400 });
  }

  const files = form.getAll("files").filter((item): item is File => item instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: { code: "40001", message: "files required" } }, { status: 400 });
  }
  if (files.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json(
      { error: { code: "40001", message: `最多一次解析 ${MAX_FILES_PER_REQUEST} 个文件` } },
      { status: 400 },
    );
  }

  const results: Array<{
    name: string;
    mime_type: string;
    kind: "document" | "video";
    parsed_text: string;
    size: number;
    attachment_id?: string;
  }> = [];

  for (const file of files) {
    if (file.size > MAX_PARSE_FILE_BYTES) {
      return NextResponse.json(
        {
          error: {
            code: "40001",
            message: `「${file.name}」超过 ${Math.round(MAX_PARSE_FILE_BYTES / 1024 / 1024)}MB 上限`,
          },
        },
        { status: 400 },
      );
    }
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = await withTimeout(
        parseAttachmentFile({
          name: file.name,
          type: file.type,
          buffer,
        }),
        PARSE_TIMEOUT_MS,
        file.name,
      );
      let attachmentId: string | undefined;
      if (MAX_ORIGINAL_RETAIN_BYTES > 0 && file.size <= MAX_ORIGINAL_RETAIN_BYTES) {
        try {
          const stored = await defaultOriginalStore.put({
            tenantId: session.tenantId,
            userId: session.userId,
            fileName: parsed.name,
            mimeType: parsed.mimeType,
            kind: parsed.kind,
            buffer,
          });
          attachmentId = stored.id;
        } catch (storeError) {
          console.warn(
            "[attachments/parse] original retain failed:",
            storeError instanceof Error ? storeError.message : storeError,
          );
        }
      }
      results.push({
        name: parsed.name,
        mime_type: parsed.mimeType,
        kind: parsed.kind,
        parsed_text: parsed.parsedText,
        size: file.size,
        ...(attachmentId ? { attachment_id: attachmentId } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "文件解析失败";
      return NextResponse.json({ error: { code: "40001", message } }, { status: 400 });
    }
  }

  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { attachments: results },
  });
}
