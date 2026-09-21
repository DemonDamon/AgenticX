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
      <ScratchChatCard chat={sample()} onClose={() => undefined} onSend={async () => true} />,
    );
    expect(html).toContain("关于这段回复");
    expect(html).toContain("选中的原文片段");
    expect(html).toContain(i18n.t("work.scratchEmpty", { ns: "workspace" }));
    expect(html).toContain(i18n.t("work.scratchComposerPlaceholder", { ns: "workspace" }));
    expect(html).toContain(i18n.t("work.scratchSend", { ns: "workspace" }));
    expect(html).toContain("report.md");
    expect(html).toContain('<input type="text"');
    expect(html).not.toContain('<input type="text" disabled');
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
    expect(html).not.toContain(i18n.t("work.scratchEmpty", { ns: "workspace" }));
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
});
