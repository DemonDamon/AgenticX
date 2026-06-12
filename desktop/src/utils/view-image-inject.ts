import type { Message } from "../store";

export const VIEW_IMAGE_INJECT_METADATA_SOURCE = "view_image_inject";

export const VIEW_IMAGE_INJECT_LEGACY_PREFIX =
  "<system-injected> attached images requested via view_image tool:";

export function isViewImageInjectMetadata(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  return String((raw as { source?: unknown }).source ?? "").trim() === VIEW_IMAGE_INJECT_METADATA_SOURCE;
}

export function isViewImageInjectMessage(
  message: Pick<Message, "role" | "content" | "metadata">,
): boolean {
  if (message.role !== "user") return false;
  if (isViewImageInjectMetadata(message.metadata)) return true;
  const text = String(message.content ?? "").trim();
  return text.startsWith(VIEW_IMAGE_INJECT_LEGACY_PREFIX);
}

export function viewImageInjectRowFromSession(item: {
  role?: unknown;
  content?: unknown;
  metadata?: unknown;
  visual_attachments?: unknown;
}): boolean {
  if (String(item.role ?? "") !== "user") return false;
  if (isViewImageInjectMetadata(item.metadata)) return true;
  const text = String(item.content ?? "").trim();
  if (text.startsWith(VIEW_IMAGE_INJECT_LEGACY_PREFIX)) return true;
  return Array.isArray(item.visual_attachments) && item.visual_attachments.length > 0;
}
