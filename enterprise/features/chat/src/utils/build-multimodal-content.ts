import type { ChatMessageAttachment } from "@agenticx/core-api";

export type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export function buildOpenAIMessageContent(
  text: string,
  attachments?: ChatMessageAttachment[],
): string | OpenAIContentPart[] {
  const imageParts = (attachments ?? [])
    .filter((item) => item.mime_type.startsWith("image/") && item.data_url.trim())
    .map(
      (item): OpenAIContentPart => ({
        type: "image_url",
        image_url: { url: item.data_url },
      }),
    );

  const trimmed = text.trim();
  if (imageParts.length === 0) return trimmed;

  const parts: OpenAIContentPart[] = [];
  if (trimmed) {
    parts.push({ type: "text", text: trimmed });
  }
  parts.push(...imageParts);
  return parts;
}
