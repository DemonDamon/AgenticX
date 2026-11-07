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
  it("renders a compact corner icon with hover name (no text pill)", () => {
    const html = wrap(<HarnessAvatarBadge metadata={{ harness: "python-agent" }} />);
    expect(html).toContain('data-harness-avatar-badge="python-agent"');
    expect(html).toContain('data-harness-badge-corner=""');
    expect(html).toContain('title="AgenticX"');
    expect(html).toContain("sr-only");
    // Icon-only chip: no truncate text pill next to the glyph.
    expect(html).not.toContain("truncate");
    expect(html).not.toContain("max-w-[9.5rem]");
  });

  it("omits when harness unknown", () => {
    const html = wrap(<HarnessAvatarBadge metadata={{}} />);
    expect(html).toBe("");
  });

  it("uses Claude Code / CodeBuddy titles", () => {
    expect(wrap(<HarnessAvatarBadge metadata={{ harness: "claude-code" }} />)).toContain(
      'title="Claude Code"',
    );
    expect(wrap(<HarnessAvatarBadge metadata={{ harness: "codebuddy" }} />)).toContain(
      'title="CodeBuddy"',
    );
  });
});
