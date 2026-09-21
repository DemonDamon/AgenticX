import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { i18n } from "../../i18n/i18n";
import type { ScratchChat } from "../../utils/scratch-chat";
import { ScratchChatCard } from "./ScratchChatCard";

function sample(partial: Partial<ScratchChat> = {}): ScratchChat {
  return {
    id: "sc-1",
    title: "关于这段回复",
    sourceKind: "message",
    sourceKey: "message:m1",
    quotedContent: "选中的原文片段",
    contextFiles: [{ path: "/tmp/report.md" }],
    sessionId: "",
    messages: [],
    floating: false,
    ...partial,
  };
}

describe("ScratchChatCard", () => {
  it("renders title, quote, empty state and an enabled send control", () => {
    const html = renderToStaticMarkup(
      <ScratchChatCard
        chat={sample()}
        paneId="pane-1"
        onClose={() => undefined}
        onSend={async () => true}
      />,
    );
    expect(html).toContain("关于这段回复");
    expect(html).toContain('data-slot="scratch-header"');
    expect(html).toContain("选中的原文片段");
    expect(html).toContain('data-slot="scratch-composer-quote"');
    expect(html).toContain('data-slot="scratch-composer"');
    expect(html).toContain(i18n.t("work.scratchEmpty", { ns: "workspace" }));
    expect(html).toContain(i18n.t("work.scratchComposerPlaceholder", { ns: "workspace" }));
    expect(html).toContain(`aria-label="${i18n.t("work.scratchSend", { ns: "workspace" })}"`);
    expect(html).toContain("report.md");
    expect(html).toContain(`aria-label="${i18n.t("work.scratchClearQuote", { ns: "workspace" })}"`);
    expect(html).toContain(`aria-label="${i18n.t("work.scratchRemoveFile", { ns: "workspace", name: "report.md" })}"`);
    expect(html).toContain('data-slot="scratch-model-picker"');
    expect(html).toContain(i18n.t("work.scratchPickModel", { ns: "workspace" }));
    expect(html).toContain("<textarea");
    expect(html).not.toContain("<textarea disabled");
    expect(html.indexOf(i18n.t("work.scratchEmpty", { ns: "workspace" }))).toBeLessThan(
      html.indexOf('data-slot="scratch-composer-quote"'),
    );
  });

  it("renders transcript rows instead of the empty state", () => {
    const html = renderToStaticMarkup(
      <ScratchChatCard
        chat={sample({
          messages: [
            { id: "u1", role: "user", content: "用户追问" },
            { id: "a1", role: "assistant", content: "助手回答" },
          ],
        })}
        onClose={() => undefined}
        onSend={async () => true}
      />,
    );
    expect(html).toContain("用户追问");
    expect(html).toContain("助手回答");
    expect(html).toContain('data-slot="message-scroller"');
    expect(html).toContain('data-scroll-anchor="true"');
    expect(html).toContain('role="log"');
    expect(html).toContain('data-slot="scratch-composer-quote"');
    expect(html).not.toContain('data-message-id="scratch-context"');
    expect(html).not.toContain(i18n.t("work.scratchEmpty", { ns: "workspace" }));
  });

  it("shows a failed reply and retry when the last assistant is empty", () => {
    const html = renderToStaticMarkup(
      <ScratchChatCard
        chat={sample({
          messages: [
            { id: "u1", role: "user", content: "什么是fan-out" },
            { id: "a1", role: "assistant", content: "" },
          ],
        })}
        paneId="pane-1"
        onClose={() => undefined}
        onSend={async () => true}
        onRetry={() => undefined}
      />,
    );
    expect(html).toContain("什么是fan-out");
    expect(html).toContain('data-slot="scratch-failed"');
    expect(html).toContain(i18n.t("work.scratchEmptyReply", { ns: "workspace" }));
    expect(html).toContain(i18n.t("work.scratchRetry", { ns: "workspace" }));
    expect(html).toContain('data-slot="scratch-retry"');
  });

  it("shows stop instead of send while a turn is in flight", () => {
    const html = renderToStaticMarkup(
      <ScratchChatCard
        chat={sample({
          messages: [
            { id: "u1", role: "user", content: "问" },
            { id: "a1", role: "assistant", content: "" },
          ],
        })}
        paneId="pane-1"
        sending
        onClose={() => undefined}
        onSend={async () => true}
      />,
    );
    expect(html).toContain('data-slot="scratch-stop"');
    expect(html).toContain(`aria-label="${i18n.t("work.scratchStop", { ns: "workspace" })}"`);
    expect(html).not.toContain(`aria-label="${i18n.t("work.scratchSend", { ns: "workspace" })}"`);
  });

  it("parses think tags and renders assistant markdown instead of raw text", () => {
    const html = renderToStaticMarkup(
      <ScratchChatCard
        chat={sample({
          messages: [
            { id: "u1", role: "user", content: "你好" },
            {
              id: "t1",
              role: "tool",
              content: "",
              toolName: "web_fetch",
              toolStatus: "running",
            },
            {
              id: "a1",
              role: "assistant",
              content:
                "<think>User just said hello</think>\n\n## 开场与敬酒\n\n| 俚语 | 含义 |\n| --- | --- |\n| 先干为敬 | 自己先喝完 |",
            },
          ],
        })}
        paneId="pane-1"
        onClose={() => undefined}
        onSend={async () => true}
      />,
    );
    expect(html).not.toContain("<think>");
    expect(html).not.toContain("</think>");
    expect(html).toContain("开场与敬酒");
    expect(html).toContain("<table");
    expect(html).toContain("先干为敬");
    expect(html).toContain("agx-im-user-bubble");
    expect(html).toContain('data-slot="scratch-tool"');
    expect(html).toContain("web_fetch");
  });

  it("shows the floated placeholder instead of the composer", () => {
    const html = renderToStaticMarkup(
      <ScratchChatCard chat={sample({ floating: true })} onClose={() => undefined} />,
    );
    expect(html).toContain(i18n.t("work.scratchFloated", { ns: "workspace" }));
    expect(html).toContain(i18n.t("work.scratchFloatedHint", { ns: "workspace" }));
    expect(html).not.toContain(i18n.t("work.scratchComposerPlaceholder", { ns: "workspace" }));
    expect(html).not.toContain(i18n.t("work.scratchEmpty", { ns: "workspace" }));
  });

  it("hides the title chrome when hideHeader is set", () => {
    const html = renderToStaticMarkup(
      <ScratchChatCard
        chat={sample()}
        paneId="pane-1"
        hideHeader
        onClose={() => undefined}
        onSend={async () => true}
      />,
    );
    expect(html).not.toContain('data-slot="scratch-header"');
    expect(html).not.toContain(`aria-label="${i18n.t("work.closeScratchTab", { ns: "workspace" })}"`);
    expect(html).toContain('data-slot="scratch-composer"');
  });

  it("exposes a float control only when docked and onFloat is provided", () => {
    const floatLabel = `aria-label="${i18n.t("work.scratchFloat", { ns: "workspace" })}"`;
    const withFloat = renderToStaticMarkup(
      <ScratchChatCard chat={sample()} onClose={() => undefined} onFloat={() => undefined} />,
    );
    expect(withFloat).toContain(floatLabel);
    const floated = renderToStaticMarkup(
      <ScratchChatCard
        chat={sample({ floating: true })}
        onClose={() => undefined}
        onFloat={() => undefined}
      />,
    );
    expect(floated).not.toContain(floatLabel);
  });

  it("docks without a second title chrome and keeps float on the tab", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "WorkPanel.tsx"), "utf8");
    expect(src).toContain("hideHeader");
    expect(src).toContain('data-slot="scratch-tab-float"');
  });
});
