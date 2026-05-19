import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeChatMarkdownContent,
  normalizeLenientEmphasisInText,
} from "./markdown-normalize.ts";

test("normalizeLenientEmphasisInText: trims spaces inside ** delimiters", () => {
  assert.equal(normalizeLenientEmphasisInText("** Effort 校准**"), "**Effort 校准**");
  assert.equal(normalizeLenientEmphasisInText("**foo **"), "**foo**");
  assert.equal(normalizeLenientEmphasisInText("__ Effort__"), "__Effort__");
});

test("normalizeLenientEmphasisInText: removes stray asterisk after closed **", () => {
  assert.equal(
    normalizeLenientEmphasisInText("**0.50/百万输入tokens** *"),
    "**0.50/百万输入tokens**",
  );
});

test("normalizeChatMarkdownContent: skips fenced and inline code", () => {
  const input = "prose ** spaced** and `** keep **` and ```\n** code **\n```";
  assert.equal(
    normalizeChatMarkdownContent(input),
    "prose **spaced** and `** keep **` and ```\n** code **\n```",
  );
});
