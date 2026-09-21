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
  it("renders title, quote, empty state and a disabled send control", () => {
    const html = renderToStaticMarkup(<ScratchChatCard chat={sample()} onClose={() => undefined} />);
    expect(html).toContain("关于这段回复");
    expect(html).toContain("选中的原文片段");
    expect(html).toContain(i18n.t("work.scratchEmpty", { ns: "workspace" }));
    expect(html).toContain(i18n.t("work.scratchComposerPlaceholder", { ns: "workspace" }));
    expect(html).toContain(i18n.t("work.scratchSend", { ns: "workspace" }));
    expect(html).toContain("disabled");
    expect(html).toContain("report.md");
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
