/**
 * Path → Prism language id for the in-app source preview.
 *
 * Author: Damon Li
 */

const INDENT_FOLD_LANGUAGES = new Set(["python", "yaml"]);

export function previewLanguageFromPath(path: string): string {
  const lower = String(path || "").toLowerCase();
  const idx = lower.lastIndexOf(".");
  const ext = idx >= 0 ? lower.slice(idx + 1) : "";
  switch (ext) {
    case "py":
    case "pyw":
      return "python";
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "json":
    case "jsonl":
    case "ndjson":
      return "json";
    case "md":
    case "mdx":
    case "markdown":
      return "markdown";
    case "html":
    case "htm":
      return "markup";
    case "sh":
    case "bash":
    case "zsh":
      return "bash";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "c":
    case "h":
      return "c";
    case "cc":
    case "cpp":
    case "cxx":
    case "hpp":
    case "hh":
      return "cpp";
    case "java":
      return "java";
    case "css":
      return "css";
    case "yml":
    case "yaml":
      return "yaml";
    case "toml":
      return "toml";
    case "sql":
      return "sql";
    case "txt":
    case "log":
    case "":
      return "plaintext";
    default:
      return "clike";
  }
}

export function isIndentFoldLanguage(language: string): boolean {
  return INDENT_FOLD_LANGUAGES.has(language);
}
