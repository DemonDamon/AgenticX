import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@agenticx/core-api";
import {
  STREAM_EMPTY_RESPONSE_ERROR,
  STREAM_INTERRUPTED_ERROR,
  STREAM_LENGTH_ERROR,
  STREAM_TRANSPORT_ERROR,
  STREAM_UPDATE_DEPTH_ERROR,
} from "@agenticx/feature-chat";
import zh from "../../messages/zh.json";
import en from "../../messages/en.json";
import { localizeChatErrorMessage, localizeChatMessageError } from "./chat-error-i18n";

const catalogs = { zh, en };

function assistant(content: string, contentLength = 0): ChatMessage {
  return {
    id: "assistant-1",
    session_id: "session-1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    role: "assistant",
    content,
    created_at: "2026-10-10T00:00:00.000Z",
    interruption: { reason: "failed", contentLength },
  };
}

describe("chat error language", () => {
  it.each([
    [STREAM_LENGTH_ERROR, "truncated"],
    [STREAM_EMPTY_RESPONSE_ERROR, "emptyResponse"],
    [STREAM_TRANSPORT_ERROR, "transport"],
    [STREAM_INTERRUPTED_ERROR, "interrupted"],
  ] as const)("translates the application notice: %s", (message, key) => {
    for (const locale of ["zh", "en"] as const) {
      const t = createTranslator({ locale, messages: catalogs[locale], namespace: "chat" });
      expect(localizeChatErrorMessage(message, t)).toBe(catalogs[locale].chat.errors[key]);
    }
  });

  it("keeps the existing display-update error translation", () => {
    const t = createTranslator({ locale: "en", messages: en, namespace: "chat" });
    expect(localizeChatErrorMessage(STREAM_UPDATE_DEPTH_ERROR, t)).toBe(en.chat.updateDepthError);
  });

  it("preserves partial model output even when it quotes the same error notice", () => {
    const prefix = `原始回复：${STREAM_LENGTH_ERROR}\n`;
    const original = assistant(`${prefix}\n${STREAM_LENGTH_ERROR}`, prefix.length);
    const t = createTranslator({ locale: "en", messages: en, namespace: "chat" });
    expect(localizeChatMessageError(original, t).content).toBe(`${prefix}\n${en.chat.errors.truncated}`);
    expect(original.content).toContain(STREAM_LENGTH_ERROR);
    expect(original.interruption?.contentLength).toBe(prefix.length);
  });

  it("preserves the reasoning block closed by the failure path", () => {
    const prefix = "<think>尚未完成的思考";
    const original = assistant(`${prefix}</think>\n\n${STREAM_EMPTY_RESPONSE_ERROR}`, prefix.length);
    const t = createTranslator({ locale: "en", messages: en, namespace: "chat" });
    expect(localizeChatMessageError(original, t).content).toBe(`${prefix}</think>\n\n${en.chat.errors.emptyResponse}`);
  });

  it("keeps old saved empty-answer notices translatable", () => {
    const original = assistant("模型未返回可展示的正文，已保留思考过程。请点击“重新生成”重试。");
    const t = createTranslator({ locale: "en", messages: en, namespace: "chat" });
    expect(localizeChatMessageError(original, t).content).toBe(en.chat.errors.emptyResponse);
  });

  it("does not rewrite user text, successful model replies, or unknown errors", () => {
    const t = createTranslator({ locale: "en", messages: en, namespace: "chat" });
    const user = { ...assistant(STREAM_EMPTY_RESPONSE_ERROR), role: "user" as const };
    const successful = { ...assistant(STREAM_EMPTY_RESPONSE_ERROR), interruption: undefined };
    const unknown = assistant("供应商返回自定义错误");
    for (const message of [user, successful, unknown]) {
      expect(localizeChatMessageError(message, t)).toBe(message);
    }
    expect(localizeChatErrorMessage(unknown.content, t)).toBe(unknown.content);
  });
});
