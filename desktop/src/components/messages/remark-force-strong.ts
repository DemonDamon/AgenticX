import type { Root, RootContent, Strong, Text } from "mdast";
import type { Parent } from "unist";
import { visit } from "unist-util-visit";

/**
 * Matches a balanced `**...**` or `__...__` run within a single line.
 * Content must be non-empty after trimming so `****` / `____` are ignored.
 */
const STRONG_DELIM_RE = /\*\*([^\n]+?)\*\*|__([^\n]+?)__/g;

function splitLeftoverStrongRuns(value: string): RootContent[] {
  if (!value.includes("**") && !value.includes("__")) {
    return [{ type: "text", value } as Text];
  }

  const nodes: RootContent[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  STRONG_DELIM_RE.lastIndex = 0;
  while ((match = STRONG_DELIM_RE.exec(value))) {
    const inner = match[1] ?? match[2] ?? "";
    if (!inner.trim()) continue;
    if (match.index > lastIndex) {
      nodes.push({ type: "text", value: value.slice(lastIndex, match.index) } as Text);
    }
    nodes.push({
      type: "strong",
      children: [{ type: "text", value: inner }],
    } as Strong);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) {
    nodes.push({ type: "text", value: value.slice(lastIndex) } as Text);
  }
  return nodes.length > 0 ? nodes : [{ type: "text", value } as Text];
}

/**
 * remark-gfm follows strict CommonMark emphasis "flanking" rules: a `**`
 * delimiter touching a CJK character on one side and punctuation (quotes,
 * brackets, etc.) on the other fails to open/close emphasis. LLM output like
 * `版**"标题"**的说法` therefore renders as literal asterisks instead of bold,
 * while `**普通加粗**文字` right next to it renders fine — the inconsistency
 * users report as "MD 格式渲染时好时坏".
 *
 * This plugin runs after remark-gfm and converts any leftover balanced
 * `**...**` / `__...__` runs still present in plain text nodes into real
 * `strong` nodes, matching the lenient bold handling most chat clients (e.g.
 * Doubao) apply to model-authored markdown.
 */
export default function remarkForceStrongEmphasis() {
  return (tree: Root) => {
    visit(tree, "text", (node: Text, index, parent: Parent | undefined) => {
      if (index === undefined || !parent) return undefined;
      if (!node.value.includes("**") && !node.value.includes("__")) return undefined;

      const replacement = splitLeftoverStrongRuns(node.value);
      if (replacement.length === 1 && replacement[0].type === "text") return undefined;

      parent.children.splice(index, 1, ...replacement);
      return index + replacement.length;
    });
  };
}
