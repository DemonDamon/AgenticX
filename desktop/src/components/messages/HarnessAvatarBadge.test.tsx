import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { HarnessAvatarBadge } from "./HarnessAvatarBadge";

void i18n.use(initReactI18next).init({
  lng: "zh",
  resources: {
    zh: {
      chat: {
        harness: {
          badgeAgenticX: "AgenticX",
          badgeClaudeCode: "Claude Code",
          badgeCodeBuddy: "CodeBuddy",
          badgeOther: "{{name}}",
        },
      },
    },
  },
});

function wrap(node: React.ReactNode) {
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
}

describe("HarnessAvatarBadge", () => {
  it("renders AgenticX for builtin metadata", () => {
    const html = wrap(<HarnessAvatarBadge metadata={{ harness: "python-agent" }} />);
    expect(html).toContain("data-harness-avatar-badge=\"python-agent\"");
    expect(html).toContain("AgenticX");
  });

  it("omits when harness unknown", () => {
    const html = wrap(<HarnessAvatarBadge metadata={{}} />);
    expect(html).toBe("");
  });
});
