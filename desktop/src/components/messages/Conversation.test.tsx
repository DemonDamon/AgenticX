/**
 * Author: Damon Li
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Conversation,
  ConversationBubble,
  ConversationContent,
  MaybeConversationBubble,
} from "./Conversation";

describe("Conversation", () => {
  it("renders a compact thread slot", () => {
    const html = renderToStaticMarkup(
      <Conversation className="mx-auto w-full max-w-4xl">
        <ConversationBubble align="start">
          <ConversationContent>收到，我来看。</ConversationContent>
        </ConversationBubble>
        <ConversationBubble align="end">
          <ConversationContent>采用方案 A</ConversationContent>
        </ConversationBubble>
      </Conversation>,
    );
    expect(html).toContain('data-slot="conversation"');
    expect(html).toContain("gap-2");
    expect(html).toContain('data-slot="conversation-bubble"');
    expect(html).toContain('data-align="start"');
    expect(html).toContain('data-align="end"');
    expect(html).toContain('data-slot="conversation-content"');
    expect(html).toContain("max-w-[var(--agx-conversation-bubble-max)]");
    expect(html).toContain("收到，我来看。");
    expect(html).toContain("采用方案 A");
  });

  it("keeps a plain div when the conversation slot is inactive", () => {
    const html = renderToStaticMarkup(
      <MaybeConversationBubble active={false} align="start" className="plain-col">
        Meta 正文
      </MaybeConversationBubble>,
    );
    expect(html).toContain("plain-col");
    expect(html).toContain("Meta 正文");
    expect(html).not.toContain("data-slot");
  });
});
