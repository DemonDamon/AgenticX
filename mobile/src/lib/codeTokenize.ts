/**
 * 代码轻量语法着色 tokenizer —— 纯 TS、零依赖（可单测）。
 *
 * 单遍扫描：注释 → 字符串 → 数字 → 标识符（关键字/函数名）→ 其余。
 * 用主流语言关键字并集，覆盖 Python/C/C++/JS/TS/Bash 通用模式，
 * 不做逐语言完整高亮（移动端对话场景足够，且免掉 prism 体积）。
 */

export type TokenKind = "plain" | "keyword" | "string" | "comment" | "number" | "fn";
export type Token = { text: string; kind: TokenKind };

/** 注释语法随语言分支：# 系 vs // 系 */
export type CommentStyle = { hash: boolean; slash: boolean };

const HASH_LANGS = /^(python|py|sh|bash|shell|zsh|yaml|yml|toml|ruby|rb|perl|makefile|conf|ini|dockerfile)$/i;
const SLASH_LANGS = /^(c|cpp|c\+\+|h|hpp|java|js|jsx|ts|tsx|go|rust|rs|swift|kotlin|kt|php|scala|dart|cs)$/i;

/** 按 fence 语言标签推断注释语法；未知语言两者都开（宽松处理） */
export function commentStyleFor(language: string): CommentStyle {
  const lang = language.trim().toLowerCase();
  if (HASH_LANGS.test(lang)) return { hash: true, slash: false };
  if (SLASH_LANGS.test(lang)) return { hash: false, slash: true };
  return { hash: true, slash: true };
}

/** 主流语言关键字并集（混入无害，只影响着色） */
const KEYWORDS = new Set([
  // Python
  "def", "return", "import", "from", "class", "if", "elif", "else", "for",
  "while", "try", "except", "finally", "with", "as", "pass", "break",
  "continue", "in", "is", "not", "and", "or", "None", "True", "False",
  "lambda", "yield", "raise", "global", "nonlocal", "assert", "async",
  "await", "del", "self",
  // C / C++
  "int", "float", "double", "char", "void", "long", "short", "unsigned",
  "signed", "struct", "enum", "union", "typedef", "const", "static",
  "extern", "sizeof", "switch", "case", "default", "do", "goto", "include",
  "define", "printf", "scanf", "malloc", "free", "NULL",
  // JS / TS
  "let", "var", "function", "new", "this", "typeof", "instanceof",
  "throw", "catch", "of", "null", "undefined", "export", "extends",
  "super", "interface", "type", "implements", "readonly", "public",
  "private", "protected", "console",
]);

const IDENT_START = /[A-Za-z_$]/;
const IDENT_BODY = /[A-Za-z0-9_$]/;

export function tokenizeCode(code: string, style: CommentStyle = { hash: true, slash: true }): Token[] {
  const tokens: Token[] = [];
  let plain = "";
  const flush = () => {
    if (plain) {
      // 相邻 plain 合并，减少 token 数量
      const prev = tokens[tokens.length - 1];
      if (prev?.kind === "plain") prev.text += plain;
      else tokens.push({ text: plain, kind: "plain" });
      plain = "";
    }
  };
  let i = 0;
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    const next = i + 1 < n ? code[i + 1] : "";
    // 行注释：#（Python/Shell 系）或 //（C/JS 系）
    if ((style.hash && ch === "#") || (style.slash && ch === "/" && next === "/")) {
      flush();
      let j = code.indexOf("\n", i);
      if (j === -1) j = n;
      tokens.push({ text: code.slice(i, j), kind: "comment" });
      i = j;
      continue;
    }
    // 块注释 /* */
    if (ch === "/" && next === "*") {
      flush();
      let j = code.indexOf("*/", i + 2);
      j = j === -1 ? n : j + 2;
      tokens.push({ text: code.slice(i, j), kind: "comment" });
      i = j;
      continue;
    }
    // 字符串（r"" / f'' 等前缀整体收进 token）
    const isQuote = /['"`]/.test(ch);
    const isPrefixQuote = /[rRbBuUfF]/.test(ch) && /['"]/.test(next);
    if (isQuote || isPrefixQuote) {
      const quote = isQuote ? ch : next;
      let j = isQuote ? i + 1 : i + 2;
      while (j < n) {
        if (code[j] === "\\") { j += 2; continue; }
        if (code[j] === quote) { j += 1; break; }
        if (code[j] === "\n") break; // 未闭合到行尾为止
        j += 1;
      }
      flush();
      tokens.push({ text: code.slice(i, j), kind: "string" });
      i = j;
      continue;
    }
    // 数字（排除标识符内的数字）
    if (/[0-9]/.test(ch) && !(i > 0 && IDENT_BODY.test(code[i - 1]))) {
      flush();
      let j = i;
      while (j < n && /[0-9a-fA-FxX._]/.test(code[j])) j += 1;
      tokens.push({ text: code.slice(i, j), kind: "number" });
      i = j;
      continue;
    }
    // 标识符
    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < n && IDENT_BODY.test(code[j])) j += 1;
      const word = code.slice(i, j);
      flush();
      if (KEYWORDS.has(word)) tokens.push({ text: word, kind: "keyword" });
      else if (code[j] === "(") tokens.push({ text: word, kind: "fn" });
      else tokens.push({ text: word, kind: "plain" });
      i = j;
      continue;
    }
    plain += ch;
    i += 1;
  }
  flush();
  return tokens;
}
