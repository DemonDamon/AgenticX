/**
 * Canonical assistant output parser (think / followups protocol).
 * Mirrors agenticx/runtime/assistant_output.py — keep both in sync via the
 * shared golden fixture under tests/fixtures/assistant_output_protocol_cases.json.
 *
 * Author: Damon Li
 */

const MINIMAX_ARTIFACT_RE =
  /[\]\[<>~!|]+\s*\/?\s*minimax[a-z_:]*\s*[\]\[<>~!|]*/gi;
const ZERO_WIDTH_RE = /[\u200b\u200c\u200d\u2060\ufeff\u00ad]/g;
const RESERVED_TAG_TOKEN_RE = /<\/?\s*think\b|<\/?\s*followups\b/i;
const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const TAG_NAME_RE = /^(?<closing>\/?)\s*(?<name>think|followups)\b(?<rest>.*)$/is;

export type ParsedAssistantOutputForUi = {
  reasoning: string;
  visibleBody: string;
  suggestedQuestions: string[];
  protocolErrors: string[];
  malformed: boolean;
};

export function stripModelControlArtifacts(text: string): string {
  if (!text || !text.toLowerCase().includes("minimax")) return text;
  return text.replace(MINIMAX_ARTIFACT_RE, "").trim();
}

function isMarkdownArtifactLine(line: string): boolean {
  const s = line.trim();
  if (!s) return true;
  if (s.startsWith("```") || s.endsWith("```")) return true;
  if (s.startsWith("#")) return true;
  if (/^\|.*\|$/.test(s)) return true;
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(s)) return true;
  return false;
}

export function sanitizeSuggestedQuestions(
  raw: unknown,
  visibleBody: string,
): string[] {
  if (!String(visibleBody ?? "").trim()) return [];
  let candidates: string[];
  if (typeof raw === "string") {
    candidates = raw.split(/\r?\n/);
  } else if (Array.isArray(raw)) {
    candidates = raw.map((item) => String(item));
  } else {
    return [];
  }
  const lines: string[] = [];
  for (const item of candidates) {
    const trimmed = stripModelControlArtifacts(String(item).trim());
    if (trimmed) lines.push(trimmed);
  }
  if (lines.length !== 3) return [];
  for (const line of lines) {
    if (line.length < 1 || line.length > 160) return [];
    if (RESERVED_TAG_TOKEN_RE.test(line)) return [];
    if (isMarkdownArtifactLine(line)) return [];
  }
  return lines;
}

function normalizeTagInner(inner: string): string {
  return inner.replace(ZERO_WIDTH_RE, "").trim();
}

function classifyTag(
  inner: string,
): { name: string; isClosing: boolean; noncanonical: boolean } | null {
  const normalized = normalizeTagInner(inner);
  if (!normalized) return null;
  const match = TAG_NAME_RE.exec(normalized);
  if (!match || !match.groups) return null;
  const name = match.groups.name.toLowerCase();
  const isClosing = Boolean(match.groups.closing);
  const rest = match.groups.rest ?? "";
  const compactCanonical = `${isClosing ? "/" : ""}${name}`;
  const originalCompact = inner.replace(ZERO_WIDTH_RE, "").replace(/\s+/g, "").toLowerCase();
  let noncanonical = originalCompact !== compactCanonical || Boolean(rest.trim());
  if (inner !== inner.trim() || inner.includes("\n") || inner.includes("\r")) {
    noncanonical = true;
  }
  if (ZERO_WIDTH_RE.test(inner)) noncanonical = true;
  return { name, isClosing, noncanonical };
}

class ProtocolErrorSet {
  private items: string[] = [];
  private seen = new Set<string>();

  add(code: string): void {
    if (this.seen.has(code)) return;
    this.seen.add(code);
    this.items.push(code);
  }

  asArray(): string[] {
    return [...this.items];
  }
}

class StreamParser {
  private carry = "";
  private stack: string[] = [];
  private body = "";
  private reasoning = "";
  private followupBuf = "";
  private followupsBlocks = 0;
  private followupsInvalid = false;
  private discardUntil: string | null = null;
  private errors = new ProtocolErrorSet();
  private safeStream = "";
  private thinkOpenEmitted = false;

  feed(chunk: string): string {
    if (!chunk) return "";
    const before = this.safeStream.length;
    this.consume(this.carry + chunk, false);
    return this.safeStream.slice(before);
  }

  finalize(): ParsedAssistantOutputForUi {
    if (this.carry) {
      this.emitText(this.carry);
      this.carry = "";
    }
    this.finalizeErrors();
    return this.toParsed();
  }

  private consume(data: string, finalize: boolean): void {
    let i = 0;
    this.carry = "";
    while (i < data.length) {
      if (data[i] !== "<") {
        this.emitText(data[i]!);
        i += 1;
        continue;
      }
      const close = data.indexOf(">", i + 1);
      if (close < 0) {
        if (!finalize) {
          this.carry = data.slice(i);
          return;
        }
        this.emitText(data.slice(i));
        return;
      }
      const inner = data.slice(i + 1, close);
      const classified = classifyTag(inner);
      if (!classified) {
        this.emitText(data.slice(i, close + 1));
        i = close + 1;
        continue;
      }
      if (classified.noncanonical) this.errors.add("noncanonical_reserved_tag");
      this.handleTag(classified.name, classified.isClosing);
      i = close + 1;
    }
  }

  private handleTag(name: string, isClosing: boolean): void {
    if (this.discardUntil !== null) {
      const expect = this.discardUntil;
      if (isClosing && name === expect) {
        this.discardUntil = null;
        return;
      }
      if (!isClosing) return;
      if (
        expect === "followups" &&
        isClosing &&
        name === "think" &&
        this.stack.length > 0 &&
        this.stack[this.stack.length - 1] === "think"
      ) {
        this.errors.add("mismatched_close");
        this.closeThinkForStream();
        this.stack.pop();
        return;
      }
      if (
        expect === "think" &&
        isClosing &&
        name === "followups" &&
        this.stack.length > 0 &&
        this.stack[this.stack.length - 1] === "followups"
      ) {
        this.errors.add("mismatched_close");
        this.stack.pop();
        this.followupsInvalid = true;
        this.discardUntil = null;
        return;
      }
      return;
    }
    if (!isClosing) {
      this.handleOpen(name);
      return;
    }
    this.handleClose(name);
  }

  private handleOpen(name: string): void {
    if (this.stack.length > 0) {
      const top = this.stack[this.stack.length - 1]!;
      if (top !== name) {
        this.errors.add("nested_reserved_tag");
        if (top === "think" && name === "followups") {
          this.followupsInvalid = true;
          this.discardUntil = "followups";
          return;
        }
        if (top === "followups" && name === "think") {
          this.followupsInvalid = true;
          this.discardUntil = "think";
          return;
        }
      } else {
        this.errors.add("nested_reserved_tag");
        this.discardUntil = name;
        if (name === "followups") this.followupsInvalid = true;
        return;
      }
    }
    if (name === "think") {
      this.stack.push("think");
      this.safeStream += "<think>";
      this.thinkOpenEmitted = true;
      return;
    }
    this.stack.push("followups");
    this.followupBuf = "";
  }

  private handleClose(name: string): void {
    if (this.stack.length === 0) {
      this.errors.add("stray_close");
      return;
    }
    const top = this.stack[this.stack.length - 1]!;
    if (top !== name) {
      this.errors.add("mismatched_close");
      if (this.stack.includes(name)) {
        while (this.stack.length > 0 && this.stack[this.stack.length - 1] !== name) {
          const removed = this.stack.pop();
          if (removed === "think") this.closeThinkForStream();
          else if (removed === "followups") this.followupsInvalid = true;
        }
        if (this.stack.length > 0 && this.stack[this.stack.length - 1] === name) {
          this.stack.pop();
          if (name === "think") this.closeThinkForStream();
          else if (name === "followups") this.finishFollowupsBlock();
        }
      } else {
        this.errors.add("stray_close");
      }
      return;
    }
    this.stack.pop();
    if (name === "think") {
      this.closeThinkForStream();
      return;
    }
    this.finishFollowupsBlock();
  }

  private closeThinkForStream(): void {
    if (this.thinkOpenEmitted) {
      this.safeStream += "</think>";
      this.thinkOpenEmitted = false;
    }
  }

  private finishFollowupsBlock(): void {
    this.followupsBlocks += 1;
    if (this.followupsBlocks > 1) {
      this.errors.add("multiple_followups");
      this.followupsInvalid = true;
    }
  }

  private emitText(text: string): void {
    if (!text) return;
    if (this.discardUntil !== null) return;
    if (this.stack.length === 0) {
      this.body += text;
      this.safeStream += text;
      return;
    }
    const top = this.stack[this.stack.length - 1]!;
    if (top === "think") {
      this.reasoning += text;
      this.safeStream += text;
      return;
    }
    if (top === "followups") {
      this.followupBuf += text;
    }
  }

  private finalizeErrors(): void {
    if (this.discardUntil === "followups") this.errors.add("unclosed_followups");
    else if (this.discardUntil === "think") this.errors.add("unclosed_think");
    for (const name of [...this.stack]) {
      if (name === "think") this.errors.add("unclosed_think");
      else if (name === "followups") this.errors.add("unclosed_followups");
    }
    this.stack = [];
    this.closeThinkForStream();
  }

  private toParsed(): ParsedAssistantOutputForUi {
    const errors = this.errors;
    let suggestions: string[] = [];
    if (this.followupsBlocks > 1 || this.followupsInvalid) {
      suggestions = [];
    } else if (
      this.followupsBlocks === 1 &&
      !errors.asArray().includes("unclosed_followups")
    ) {
      if (!this.body.trim()) {
        errors.add("missing_visible_body");
        suggestions = [];
      } else {
        suggestions = sanitizeSuggestedQuestions(this.followupBuf, this.body);
        if (suggestions.length === 0) {
          const nonempty = this.followupBuf
            .split(/\r?\n/)
            .map((x) => stripModelControlArtifacts(x.trim()))
            .filter(Boolean);
          if (nonempty.length !== 3) errors.add("invalid_followup_count");
          else errors.add("invalid_followup_line");
        }
      }
    }
    const protocolErrors = errors.asArray();
    if (protocolErrors.length > 0) suggestions = [];
    return {
      reasoning: this.reasoning,
      visibleBody: this.body,
      suggestedQuestions: suggestions,
      protocolErrors,
      malformed: protocolErrors.length > 0,
    };
  }
}

export function parseAssistantOutputForUi(raw: string): ParsedAssistantOutputForUi {
  const parser = new StreamParser();
  parser.feed(String(raw ?? ""));
  return parser.finalize();
}

export function assistantVisibleBodyForUi(content: string): string {
  return parseAssistantOutputForUi(content).visibleBody;
}

export function normalizeFinalAssistantPayload(
  rawText: unknown,
  rawQuestions: unknown,
  rawTurnTerminal: unknown,
  rawTerminalReason: unknown,
): {
  text: string;
  suggestedQuestions: string[];
  incomplete: boolean;
  turnTerminal: boolean;
  terminalReason?: string;
} {
  const parsed = parseAssistantOutputForUi(String(rawText ?? ""));
  const text = parsed.visibleBody.trim();
  const terminalReason = String(rawTerminalReason ?? "").trim() || undefined;
  return {
    text,
    suggestedQuestions: parsed.malformed
      ? []
      : sanitizeSuggestedQuestions(rawQuestions, text),
    incomplete: !text,
    turnTerminal:
      rawTurnTerminal === true
        ? true
        : rawTurnTerminal === false
          ? false
          : text.length > 0,
    terminalReason,
  };
}
