import type { ChatMessage, ChatMessageAttachment } from "../types";

export type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export function buildOpenAIMessageContent(
  text: string,
  attachments?: ChatMessageAttachment[],
): string | OpenAIContentPart[] {
  const imageParts = (attachments ?? [])
    .filter((item) => item.mimeType.startsWith("image/") && item.dataUrl.trim())
    .map(
      (item): OpenAIContentPart => ({
        type: "image_url",
        image_url: { url: item.dataUrl },
      }),
    );

  const trimmed = text.trim();
  if (imageParts.length === 0) return trimmed;

  const parts: OpenAIContentPart[] = [];
  if (trimmed) parts.push({ type: "text", text: trimmed });
  parts.push(...imageParts);
  return parts;
}

export function toGatewayMessage(message: Pick<ChatMessage, "role" | "content" | "attachments">): {
  role: string;
  content: string | OpenAIContentPart[];
} {
  return {
    role: message.role,
    content: buildOpenAIMessageContent(message.content, message.attachments),
  };
}
