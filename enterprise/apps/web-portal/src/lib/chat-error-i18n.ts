import type { ChatMessage } from "@agenticx/core-api";
import {
  prepareAssistantContinuation,
  STREAM_EMPTY_RESPONSE_ERROR,
  STREAM_INTERRUPTED_ERROR,
  STREAM_LENGTH_ERROR,
  STREAM_TRANSPORT_ERROR,
  STREAM_UPDATE_DEPTH_ERROR,
} from "@agenticx/feature-chat";

type ErrorTranslationKey =
  | "updateDepthError"
  | "errors.emptyResponse"
  | "errors.interrupted"
  | "errors.transport"
  | "errors.truncated";
type TranslateError = (key: ErrorTranslationKey) => string;

// Match only known application notices, never translate arbitrary model text.
// Stored messages keep their original bytes for checkpoints and continuation.
const errorKeys = new Map<string, ErrorTranslationKey>([
  [STREAM_UPDATE_DEPTH_ERROR, "updateDepthError"],
  [STREAM_LENGTH_ERROR, "errors.truncated"],
  [STREAM_EMPTY_RESPONSE_ERROR, "errors.emptyResponse"],
  [STREAM_TRANSPORT_ERROR, "errors.transport"],
  [STREAM_INTERRUPTED_ERROR, "errors.interrupted"],
  // Previously persisted empty-answer copy, before the shared recovery notice.
  ["模型未返回可展示的正文，已保留思考过程。请点击“重新生成”重试。", "errors.emptyResponse"],
  // SDK transport notice, kept so older bubbles still localize.
  ["连接提前中断，未收到完成标记", "errors.transport"],
]);

export function localizeChatErrorMessage(message: string, t: TranslateError): string {
  const requestIdPrefix = "\n请求 ID: ";
  const requestIdIndex = message.lastIndexOf(requestIdPrefix);
  const body = requestIdIndex < 0 ? message : message.slice(0, requestIdIndex);
  const key = errorKeys.get(body.trim());
  if (!key) return message;
  const translated = body.replace(body.trim(), t(key));
  return requestIdIndex < 0 ? translated : `${translated}${message.slice(requestIdIndex)}`;
}

/** Localize only the appended failure notice, preserving generated text and reasoning. */
export function localizeChatMessageError(message: ChatMessage, t: TranslateError): ChatMessage {
  if (message.role !== "assistant" || !message.interruption) return message;
  const prefix = message.content.slice(0, message.interruption.contentLength);
  const retained = prepareAssistantContinuation(prefix).retainedContent;
  if (!message.content.startsWith(retained)) return message;
  const notice = message.content.slice(retained.length);
  const translated = localizeChatErrorMessage(notice, t);
  return translated === notice ? message : { ...message, content: retained + translated };
}
