import Prism from "prismjs";
import "./chat-prism-setup";

const LANG_ALIASES: Record<string, string> = {
  py: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  rs: "rust",
  golang: "go",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Raw `language-xxx` token from markdown; null / text-like => no Prism grammar. */
export function resolvePrismLang(langTag: string | null | undefined): string | null {
  if (langTag == null || langTag === "") return null;
  const k = langTag.toLowerCase();
  if (k === "text" || k === "plain" || k === "plaintext") return null;
  return LANG_ALIASES[k] ?? k;
}

export function highlightChatCode(text: string, langTag: string | null): string {
  const lang = resolvePrismLang(langTag);
  if (!lang) return escapeHtml(text);
  const grammar = Prism.languages[lang];
  if (!grammar) return escapeHtml(text);
  try {
    return Prism.highlight(text, grammar, lang);
  } catch {
    return escapeHtml(text);
  }
}
