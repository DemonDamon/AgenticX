import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import { i18n } from "../../i18n/i18n";
import type { SearchReference } from "../../types/search-references";
import { CitationMarkdownBody } from "./CitationMarkdownBody";

const REFS: SearchReference[] = [
  {
    id: 1,
    title: "API reference - TypeSafe AI",
    url: "https://docs.typesafe.ai/api",
    snippet: "Full HTTP API reference",
    source: "web",
    provider: "duckduckgo",
    domain: "docs.typesafe.ai",
  },
];

const SECOND_TURN_BODY = `
## 怎么调用

**端点**：\`POST https://api.typesafe.ai/v1/systemone\`，Bearer 鉴权 [1]

\`\`\`python
import os, requests

resp = requests.post(
    "https://api.typesafe.ai/v1/systemone",
    headers={"Authorization": f"Bearer {os.environ['TYPESAFE_API_KEY']}"},
)
print(resp.json())
\`\`\`
`;

describe("CitationMarkdownBody fenced code with citations", () => {
  it("keeps a python fence as one highlighted block when the turn has web references", () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <CitationMarkdownBody content={SECOND_TURN_BODY} references={REFS} />
      </I18nextProvider>,
    );

    expect(html).toContain("language-python");
    expect(html).toContain('class="token keyword">import</span>');
    expect(html).toContain("requests");
    expect(html).toContain("TYPESAFE_API_KEY");
    expect(html.match(/language-python/g)?.length).toBe(1);
    expect(html).not.toMatch(/tracking-wider">text</);
    expect(html).not.toMatch(/<em[^>]*>API<\/em>/);
  });
});
