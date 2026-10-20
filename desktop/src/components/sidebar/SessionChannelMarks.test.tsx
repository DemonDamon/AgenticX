import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/i18n";
import { SessionChannelMarks } from "./SessionChannelMarks";

describe("SessionChannelMarks", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh");
  });

  it("shows a short channel pill only on the bound session", () => {
    const html = renderToStaticMarkup(
      <SessionChannelMarks sessionId="bound-wechat" wechatBoundId="bound-wechat" feishuBoundId="other" />,
    );
    expect(html).toContain("微信");
    expect(html).toContain("已绑定微信");
    expect(html).not.toContain("飞书");
  });

  it("renders nothing when the session is not bound", () => {
    const html = renderToStaticMarkup(
      <SessionChannelMarks sessionId="plain" wechatBoundId="bound-wechat" feishuBoundId="bound-feishu" />,
    );
    expect(html).toBe("");
  });
});
