export type ComposerAttachmentStatus = "parsing" | "ready" | "error";

export type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  status: ComposerAttachmentStatus;
  dataUrl?: string;
  errorText?: string;
};

export const MAX_IMAGE_ATTACHMENTS = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
