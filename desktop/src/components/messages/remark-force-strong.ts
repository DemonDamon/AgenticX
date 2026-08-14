import type { PhrasingContent, Root, RootContent, Strong, Text } from "mdast";
import type { Parent } from "unist";
import { visit } from "unist-util-visit";

/**
 * Matches a balanced `**...**` or `__...__` run within a single line.
 * Content must be non-empty after trimming so `****` / `____` are ignored.
 */
const STRONG_DELIM_RE = /\*\*([^\n]+?)\*\*|__([^\n]+?)__/g;

/** Left sibling of a mispaired strong: `…**inner` with no closer in this node. */
const LEFT_ORPHAN_OPEN_RE = /^(.*)\*\*([^*\n]+)$/;

/** Right sibling of a mispaired strong: `inner**…` with no opener in this node. */
const RIGHT_ORPHAN_CLOSE_RE = /^([^*\n]+)\*\*([\s\S]*)$/;

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

function plainTextFromPhrasing(nodes: PhrasingContent[] | undefined): string {
  if (!nodes?.length) return "";
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += node.value;
      continue;
    }
    if ("children" in node && Array.isArray(node.children)) {
      out += plainTextFromPhrasing(node.children as PhrasingContent[]);
    }
  }
  return out;
}

function makeStrong(inner: string): Strong {
  return {
    type: "strong",
    children: [{ type: "text", value: inner }],
  };
}

/**
 * GFM sometimes cross-pairs adjacent LLM bold spans such as
 * `**「甲」**，形状像**乙**` into:
 *   text("…**「甲」") + strong("，形状像") + text("乙**…")
 * Reconstruct the original delimiter string and re-split into two strongs.
 */
function tryRepairMispairedAdjacentStrong(parent: Parent, index: number): number | null {
  const left = parent.children[index];
  const mid = parent.children[index + 1];
  const right = parent.children[index + 2];
  if (!left || !mid || !right) return null;
  if (left.type !== "text" || mid.type !== "strong" || right.type !== "text") return null;

  const leftMatch = LEFT_ORPHAN_OPEN_RE.exec(left.value);
  const rightMatch = RIGHT_ORPHAN_CLOSE_RE.exec(right.value);
  if (!leftMatch || !rightMatch) return null;

  const prefix = leftMatch[1] ?? "";
  const firstInner = leftMatch[2] ?? "";
  const secondInner = rightMatch[1] ?? "";
  const suffix = rightMatch[2] ?? "";
  if (!firstInner.trim() || !secondInner.trim()) return null;

  const midText = plainTextFromPhrasing(mid.children);
  // Mispaired glue is almost always short punctuation/CJK without emphasis markers.
  if (!midText || midText.includes("*") || midText.includes("_")) return null;

  const replacement: RootContent[] = [];
  if (prefix) replacement.push({ type: "text", value: prefix } as Text);
  replacement.push(makeStrong(firstInner));
  replacement.push({ type: "text", value: midText } as Text);
  replacement.push(makeStrong(secondInner));
  if (suffix) replacement.push({ type: "text", value: suffix } as Text);

  parent.children.splice(index, 3, ...replacement);
  return index + replacement.length;
}

function rebalanceMispairedStrongSiblings(parent: Parent): void {
  let i = 0;
  while (i < parent.children.length - 2) {
    const next = tryRepairMispairedAdjacentStrong(parent, i);
    i = next ?? i + 1;
  }
}

/**
 * remark-gfm follows strict CommonMark emphasis "flanking" rules: a `**`
 * delimiter touching a CJK character on one side and punctuation (quotes,
 * brackets, etc.) on the other fails to open/close emphasis. LLM output like
 * `版**"标题"**的说法` therefore renders as literal asterisks instead of bold,
 * while `**普通加粗**文字` right next to it renders fine — the inconsistency
 * users report as "MD 格式渲染时好时坏".
 *
 * A second failure mode: two adjacent spans
 * `**「甲」**，形状像**乙**` get cross-paired by GFM into
 * text + strong(glue) + text, leaving orphan `**` on both sides. The single-node
 * leftover pass cannot fix that; {@link rebalanceMispairedStrongSiblings} does.
 *
 * This plugin runs after remark-gfm and converts any leftover balanced
 * `**...**` / `__...__` runs still present in plain text nodes into real
 * `strong` nodes, matching the lenient bold handling most chat clients (e.g.
 * Doubao) apply to model-authored markdown.
 */
export default function remarkForceStrongEmphasis() {
  return (tree: Root) => {
    visit(tree, (node) => {
      if (node.type === "text" || node.type === "code" || node.type === "inlineCode") {
        return;
      }
      if (!("children" in node) || !Array.isArray((node as Parent).children)) return;
      rebalanceMispairedStrongSiblings(node as Parent);
    });

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
