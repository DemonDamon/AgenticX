export type WidgetFormatHint = "svg" | "html" | "mermaid" | "";

export type PartialShowWidget = {
  title: string;
  widgetCode: string;
  widgetFormat: WidgetFormatHint;
  readyForPreview: boolean;
};

function decodeSimpleJsonEscapes(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = input[i + 1];
    if (next == null) break;
    i += 1;
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "b") out += "\b";
    else if (next === "f") out += "\f";
    else if (next === "\\" || next === '"' || next === "/") out += next;
    else if (next === "u") {
      const hex = input.slice(i + 1, i + 5);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else {
        out += "u";
      }
    } else {
      out += next;
    }
  }
  return out;
}

function extractJsonStringPrefix(raw: string, from: number): string {
  let out = "";
  let escaped = false;
  for (let i = from; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escaped) {
      out += `\\${ch}`;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      break;
    }
    out += ch;
  }
  return decodeSimpleJsonEscapes(out);
}

function parseWidgetFormatHint(raw: string): WidgetFormatHint {
  const formatMatch = raw.match(/"widget_format"\s*:\s*"((?:\\.|[^"\\])*)"/i);
  if (formatMatch?.[1] == null) return "";
  const value = decodeSimpleJsonEscapes(formatMatch[1]).trim().toLowerCase();
  if (value === "svg" || value === "html" || value === "mermaid") return value;
  return "";
}

function isReadyForPreview(widgetFormat: WidgetFormatHint, widgetCode: string): boolean {
  if (widgetFormat === "mermaid") return false;
  return /<svg\b/i.test(widgetCode);
}

/** Extract title + widget_code prefix from possibly truncated tool args JSON. */
export function extractPartialShowWidgetArgs(argumentsRaw: string): PartialShowWidget | null {
  const raw = String(argumentsRaw ?? "");
  if (!raw.trim()) return null;

  let title = "";
  const titleMatch = raw.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/i);
  if (titleMatch?.[1] != null) {
    title = decodeSimpleJsonEscapes(titleMatch[1]).trim();
  }

  const widgetFormat = parseWidgetFormatHint(raw);

  const widgetKey = /"widget_code"\s*:\s*"/i.exec(raw);
  if (!widgetKey) {
    if (!title && !widgetFormat) return null;
    return { title, widgetCode: "", widgetFormat, readyForPreview: false };
  }

  const keyEnd = widgetKey.index + widgetKey[0].length;
  const widgetCode = extractJsonStringPrefix(raw, keyEnd);
  return {
    title,
    widgetCode,
    widgetFormat,
    readyForPreview: isReadyForPreview(widgetFormat, widgetCode),
  };
}

export function finalizePartialSvg(code: string): string | null {
  const trimmed = String(code ?? "").trim();
  if (!/<svg\b/i.test(trimmed)) return null;
  let fixed = trimmed;
  if (!/<\/svg>\s*$/i.test(fixed)) {
    fixed = fixed.replace(/<[^>]*$/, "");
    fixed = `${fixed}\n</svg>`;
  }
  return fixed;
}
