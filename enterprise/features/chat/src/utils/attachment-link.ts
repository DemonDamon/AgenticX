import type { ChatMessageAttachment } from "@agenticx/core-api";

export type AttachmentLinkPart =
  | { type: "text"; value: string }
  | { type: "attachment"; value: string; attachment: ChatMessageAttachment };

/** Linkable session attachments (parsed documents only), longest name first. */
export function linkableSessionAttachments(
  attachments: ChatMessageAttachment[] | undefined,
): ChatMessageAttachment[] {
  if (!attachments?.length) return [];
  return [...attachments]
    .filter((item) => item.parsed_text?.trim() && item.name.trim())
    .sort((a, b) => b.name.length - a.name.length);
}

/** Split plain text so known attachment filenames become link targets. */
export function splitTextByAttachmentNames(
  text: string,
  attachments: ChatMessageAttachment[] | undefined,
): AttachmentLinkPart[] {
  if (!text) return [];
  const targets = linkableSessionAttachments(attachments);
  if (targets.length === 0) return [{ type: "text", value: text }];

  const out: AttachmentLinkPart[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let bestIndex = -1;
    let bestAttachment: ChatMessageAttachment | null = null;

    for (const attachment of targets) {
      const idx = text.indexOf(attachment.name, cursor);
      if (idx < 0) continue;
      if (bestIndex < 0 || idx < bestIndex) {
        bestIndex = idx;
        bestAttachment = attachment;
      }
    }

    if (bestIndex < 0 || !bestAttachment) {
      out.push({ type: "text", value: text.slice(cursor) });
      break;
    }

    if (bestIndex > cursor) {
      out.push({ type: "text", value: text.slice(cursor, bestIndex) });
    }

    out.push({
      type: "attachment",
      value: bestAttachment.name,
      attachment: bestAttachment,
    });
    cursor = bestIndex + bestAttachment.name.length;
  }

  return out.length > 0 ? out : [{ type: "text", value: text }];
}
