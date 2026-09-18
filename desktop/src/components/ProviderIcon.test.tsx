import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProviderIcon } from "./ProviderIcon";
import { ZhipuIcon } from "../utils/provider-icons";

const chatPaneSrc = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "./ChatPane.tsx"),
  "utf8",
);

describe("Zhipu glyph clip guard", () => {
  it("paints the official Z with currentColor so light themes stay dark and dark themes stay white", () => {
    const html = renderToStaticMarkup(<ProviderIcon provider="zhipu" model="glm-5.3-flash" />);
    expect(html).toContain('overflow="visible"');
    expect(html).toContain('viewBox="-50 -50 300 300"');
    expect(html).toContain('fill="currentColor"');
    expect(html).not.toContain("#3859FF");
  });

  it("uses the same official Z and currentColor on the settings mark", () => {
    const html = renderToStaticMarkup(<ZhipuIcon size={18} />);
    expect(html).toContain('viewBox="0 0 200 200"');
    expect(html).toContain('fill="currentColor"');
    expect(html).not.toContain("#3859FF");
  });

  it("gives the model name a line box and left inset so g is not clipped by truncate", () => {
    expect(chatPaneSrc).toContain(
      "group flex h-8 min-h-8 max-w-full min-w-0 items-center gap-2 rounded-lg px-1.5 text-[13px] font-medium leading-5",
    );
    expect(chatPaneSrc).toContain("min-w-0 truncate pl-px text-text-strong");
    expect(chatPaneSrc).toContain("min-w-0 flex-1 truncate pl-px font-semibold text-text-strong");
  });
});
