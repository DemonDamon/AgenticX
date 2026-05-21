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
  cpp: "cpp",
  "c++": "cpp",
  cxx: "cpp",
  h: "cpp",
  hpp: "cpp",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function resolvePrismLang(langTag: string | null | undefined): string | null {
  if (langTag == null || langTag === "") return null;
  const key = langTag.toLowerCase();
  if (key === "text" || key === "plain" || key === "plaintext") return null;
  return LANG_ALIASES[key] ?? key;
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
