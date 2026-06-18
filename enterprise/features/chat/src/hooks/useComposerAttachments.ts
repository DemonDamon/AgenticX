"use client";

import * as React from "react";
import { ulid as newUlid } from "ulid";
import type { ChatMessageAttachment } from "@agenticx/core-api";
import type { ComposerAttachment } from "../types/composer-attachment";
import { MAX_IMAGE_ATTACHMENTS, MAX_IMAGE_BYTES } from "../types/composer-attachment";

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function useComposerAttachments() {
  const [attachments, setAttachments] = React.useState<Record<string, ComposerAttachment>>({});
  const [error, setError] = React.useState<string | null>(null);

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

  const parseLocalFile = React.useCallback((file: File) => {
    if (!isImageFile(file)) {
      setError("仅支持图片文件");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`图片大小不能超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB`);
      return;
    }
    if (readyAttachments.length >= MAX_IMAGE_ATTACHMENTS) {
      setError(`最多添加 ${MAX_IMAGE_ATTACHMENTS} 张图片`);
      return;
    }

    const id = newUlid();
    setError(null);
    setAttachments((prev) => ({
      ...prev,
      [id]: {
        id,
        name: file.name,
        size: file.size,
        mimeType: file.type || "image/*",
        status: "parsing",
      },
    }));

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      setAttachments((prev) => ({
        ...prev,
        [id]: {
          ...prev[id]!,
          status: "ready",
          dataUrl,
        },
      }));
    };
    reader.onerror = () => {
      setAttachments((prev) => ({
        ...prev,
        [id]: {
          ...prev[id]!,
          status: "error",
          errorText: "图片解析失败",
        },
      }));
    };
    reader.readAsDataURL(file);
  }, [readyAttachments.length]);

  const addFiles = React.useCallback(
    (files: File[]) => {
      for (const file of files) {
        if (!isImageFile(file)) continue;
        parseLocalFile(file);
      }
    },
    [parseLocalFile],
  );

  const toMessageAttachments = React.useCallback((): ChatMessageAttachment[] => {
    return readyAttachments
      .filter((item) => item.dataUrl)
      .map((item) => ({
        name: item.name,
        mime_type: item.mimeType,
        size: item.size,
        data_url: item.dataUrl!,
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
