"use client";

import * as React from "react";
import { ulid as newUlid } from "ulid";
import type { ChatMessageAttachment } from "@agenticx/core-api";
import type { ComposerAttachment } from "../types/composer-attachment";
import {
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  classifyAttachment,
} from "../types/composer-attachment";
import { compressImageForChat } from "../utils/compress-image";

type ParsedRow = {
  name: string;
  mime_type: string;
  kind: "document" | "video";
  parsed_text: string;
  size: number;
  attachment_id?: string;
};

const PARSE_CONCURRENCY = 3;

function parseRemoteFile(
  file: File,
  onProgress: (percent: number) => void,
  onUploadComplete: () => void,
): Promise<ParsedRow> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/chat/attachments/parse");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.upload.onload = () => {
      onProgress(99);
      onUploadComplete();
    };
    xhr.onload = () => {
      let body: {
        error?: { message?: string };
        data?: { attachments?: ParsedRow[] };
      } = {};
      try {
        body = JSON.parse(xhr.responseText) as typeof body;
      } catch {
        // keep empty body
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const message = body.error?.message || xhr.statusText || "文件解析失败";
        reject(new Error(message));
        return;
      }
      const row = body.data?.attachments?.[0];
      if (!row) {
        reject(new Error("解析结果缺失"));
        return;
      }
      resolve(row);
    };
    xhr.onerror = () => reject(new Error("网络错误，文件上传失败"));
    xhr.ontimeout = () => reject(new Error("上传超时"));
    const form = new FormData();
    form.append("files", file);
    xhr.send(form);
  });
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!, index);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

export function useComposerAttachments() {
  const [attachments, setAttachments] = React.useState<Record<string, ComposerAttachment>>({});
  const [error, setError] = React.useState<string | null>(null);
  const attachmentsRef = React.useRef(attachments);
  attachmentsRef.current = attachments;

  const readyAttachments = React.useMemo(
    () => Object.values(attachments).filter((item) => item.status === "ready"),
    [attachments],
  );

  const removeAttachment = React.useCallback((id: string) => {
    setAttachments((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const clearAttachments = React.useCallback(() => {
    setAttachments({});
  }, []);

  /** 仅在槽位仍存在时回写，并强制保留 id（避免 clear 竞态丢 key） */
  const patchAttachment = React.useCallback((id: string, patch: Partial<ComposerAttachment>) => {
    setAttachments((prev) => {
      const current = prev[id];
      if (!current) return prev;
      return {
        ...prev,
        [id]: {
          ...current,
          ...patch,
          id,
        },
      };
    });
  }, []);

  const addFiles = React.useCallback(
    (files: File[]) => {
      void (async () => {
        if (Object.keys(attachmentsRef.current).length + files.length > MAX_ATTACHMENTS) {
          setError(`最多添加 ${MAX_ATTACHMENTS} 个文件`);
          return;
        }

        const images: File[] = [];
        const docs: File[] = [];
        for (const file of files) {
          if (file.size > MAX_FILE_BYTES) {
            setError(`「${file.name}」超过 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB 上限`);
            return;
          }
          const kind = classifyAttachment(file);
          if (!kind) {
            setError(`不支持的文件类型：${file.name}`);
            return;
          }
          if (kind === "image") {
            images.push(file);
          } else {
            docs.push(file);
          }
        }

        setError(null);

        const imageSlots = images.map((file) => ({
          id: newUlid(),
          file,
        }));
        const docSlots = docs.map((file) => ({
          id: newUlid(),
          file,
        }));

        setAttachments((prev) => {
          if (Object.keys(prev).length + files.length > MAX_ATTACHMENTS) {
            return prev;
          }
          const next = { ...prev };
          for (const slot of imageSlots) {
            next[slot.id] = {
              id: slot.id,
              name: slot.file.name,
              size: slot.file.size,
              mimeType: slot.file.type || "image/*",
              kind: "image",
              status: "uploading",
              uploadProgress: 0,
            };
          }
          for (const slot of docSlots) {
            next[slot.id] = {
              id: slot.id,
              name: slot.file.name,
              size: slot.file.size,
              mimeType: slot.file.type || "application/octet-stream",
              kind: classifyAttachment(slot.file) === "video" ? "video" : "document",
              status: "uploading",
              uploadProgress: 0,
            };
          }
          return next;
        });

        for (const slot of imageSlots) {
          try {
            patchAttachment(slot.id, { status: "uploading", uploadProgress: 50 });
            const compressed = await compressImageForChat(slot.file);
            patchAttachment(slot.id, {
              status: "ready",
              dataUrl: compressed.dataUrl,
              mimeType: compressed.mimeType,
              size: compressed.size,
              uploadProgress: 100,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : "图片压缩失败";
            patchAttachment(slot.id, { status: "error", errorText: message });
            setError(message);
          }
        }

        if (docSlots.length === 0) return;

        const outcomes = await mapPool(docSlots, PARSE_CONCURRENCY, async (slot) => {
          try {
            const row = await parseRemoteFile(
              slot.file,
              (percent) => {
                patchAttachment(slot.id, { status: "uploading", uploadProgress: percent });
              },
              () => {
                patchAttachment(slot.id, { status: "parsing", uploadProgress: 100 });
              },
            );
            patchAttachment(slot.id, {
              status: "ready",
              mimeType: row.mime_type,
              kind: row.kind,
              parsedText: row.parsed_text,
              size: typeof row.size === "number" ? row.size : slot.file.size,
              ...(row.attachment_id ? { attachmentId: row.attachment_id } : {}),
            });
            return { ok: true as const };
          } catch (err) {
            const message = err instanceof Error ? err.message : "文件解析失败";
            patchAttachment(slot.id, { status: "error", errorText: message });
            return { ok: false as const, message };
          }
        });

        const failures = outcomes.filter((item) => !item.ok);
        if (failures.length === docSlots.length && failures[0] && !failures[0].ok) {
          setError(failures[0].message);
        }
      })();
    },
    [patchAttachment],
  );

  const toMessageAttachments = React.useCallback((): ChatMessageAttachment[] => {
    return readyAttachments.map((item) => ({
      name: item.name,
      mime_type: item.mimeType,
      size: item.size,
      kind: item.kind,
      ...(item.dataUrl ? { data_url: item.dataUrl } : {}),
      ...(item.parsedText ? { parsed_text: item.parsedText } : {}),
      ...(item.attachmentId ? { attachment_id: item.attachmentId } : {}),
    }));
  }, [readyAttachments]);

  return {
    attachments,
    readyAttachments,
    attachmentError: error,
    setAttachmentError: setError,
    addFiles,
    removeAttachment,
    clearAttachments,
    toMessageAttachments,
  };
}
