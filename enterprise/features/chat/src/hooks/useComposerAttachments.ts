"use client";

import * as React from "react";
import { ulid as newUlid } from "ulid";
import type { ChatMessageAttachment } from "@agenticx/core-api";
import type { ComposerAttachment } from "../types/composer-attachment";
import {
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  classifyAttachment,
} from "../types/composer-attachment";

async function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

async function parseRemoteFiles(files: File[]): Promise<
  Array<{
    name: string;
    mime_type: string;
    kind: "document" | "video";
    parsed_text: string;
    size: number;
  }>
> {
  const body = new FormData();
  for (const file of files) body.append("files", file);
  const res = await fetch("/api/chat/attachments/parse", {
    method: "POST",
    credentials: "same-origin",
    body,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const json = (await res.json()) as { error?: { message?: string } };
      if (json.error?.message) message = json.error.message;
    } catch {
      // keep statusText
    }
    throw new Error(message || "文件解析失败");
  }
  const json = (await res.json()) as {
    data?: {
      attachments?: Array<{
        name: string;
        mime_type: string;
        kind: "document" | "video";
        parsed_text: string;
        size: number;
      }>;
    };
  };
  return json.data?.attachments ?? [];
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
            if (file.size > MAX_IMAGE_BYTES) {
              setError(`图片「${file.name}」不能超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB`);
              return;
            }
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
              status: "parsing",
            };
          }
          for (const slot of docSlots) {
            next[slot.id] = {
              id: slot.id,
              name: slot.file.name,
              size: slot.file.size,
              mimeType: slot.file.type || "application/octet-stream",
              kind: classifyAttachment(slot.file) === "video" ? "video" : "document",
              status: "parsing",
            };
          }
          return next;
        });

        for (const slot of imageSlots) {
          try {
            const dataUrl = await readAsDataUrl(slot.file);
            patchAttachment(slot.id, { status: "ready", dataUrl });
          } catch {
            patchAttachment(slot.id, { status: "error", errorText: "图片读取失败" });
          }
        }

        if (docSlots.length === 0) return;

        try {
          const parsed = await parseRemoteFiles(docSlots.map((slot) => slot.file));
          for (let i = 0; i < docSlots.length; i += 1) {
            const slot = docSlots[i]!;
            const row = parsed[i];
            if (!row) {
              patchAttachment(slot.id, { status: "error", errorText: "解析结果缺失" });
              continue;
            }
            patchAttachment(slot.id, {
              status: "ready",
              mimeType: row.mime_type,
              kind: row.kind,
              parsedText: row.parsed_text,
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "文件解析失败";
          setError(message);
          for (const slot of docSlots) {
            patchAttachment(slot.id, { status: "error", errorText: message });
          }
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
