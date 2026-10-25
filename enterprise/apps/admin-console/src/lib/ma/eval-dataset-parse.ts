export type EvalItemInput = {
  query: string;
  expected_answer: string | null;
  expected_tool_trace: string[] | null;
  tags: string[];
};

const QUERY_LIMIT = 20000;
const ANSWER_LIMIT = 20000;
const ITEM_LIMIT = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTrace(value: unknown): string[] | null | "bad" {
  if (value == null) return null;
  if (!Array.isArray(value)) return "bad";
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.length > 0) {
      names.push(entry);
      continue;
    }
    if (isRecord(entry)) {
      const name = entry.tool_name ?? entry.name;
      if (typeof name === "string" && name.length > 0) {
        names.push(name);
        continue;
      }
    }
    return "bad";
  }
  return names;
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function parseObject(value: unknown, index: number, errors: string[]): EvalItemInput | null {
  const label = `第 ${index} 条`;
  if (!isRecord(value)) {
    errors.push(`${label}：缺少 query`);
    return null;
  }
  const query = value.query;
  if (typeof query !== "string" || query.length === 0) {
    errors.push(`${label}：缺少 query`);
    return null;
  }
  if (query.length > QUERY_LIMIT) errors.push(`${label}：query 超过 20000 字`);
  const answerRaw = value.expected_answer ?? value.expectedAnswer;
  let expectedAnswer: string | null = null;
  if (typeof answerRaw === "string") {
    if (answerRaw.length > ANSWER_LIMIT) errors.push(`${label}：expected_answer 超过 20000 字`);
    expectedAnswer = answerRaw;
  }
  const trace = parseTrace(value.expected_tool_trace ?? value.expectedToolTrace);
  if (trace === "bad") errors.push(`${label}：expected_tool_trace 格式不正确`);
  return {
    query,
    expected_answer: expectedAnswer,
    expected_tool_trace: trace === "bad" ? null : trace,
    tags: parseTags(value.tags),
  };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\r") continue;
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((item) => item.some((cell) => cell.length > 0));
}

export function parseEvalItems(
  format: "json" | "jsonl" | "csv",
  text: string,
): { items: EvalItemInput[]; errors: string[] } {
  const errors: string[] = [];
  const items: EvalItemInput[] = [];
  if (format === "csv") {
    const rows = parseCsv(text);
    const header = rows[0]?.map((cell) => cell.trim()) ?? [];
    const queryIndex = header.indexOf("query");
    if (queryIndex < 0) {
      return { items: [], errors: ["CSV 缺少 query 列"] };
    }
    const answerIndex = header.indexOf("expected_answer");
    rows.slice(1).forEach((row, index) => {
      const parsed = parseObject(
        {
          query: row[queryIndex] ?? "",
          expected_answer: answerIndex >= 0 ? row[answerIndex] ?? "" : undefined,
        },
        index + 1,
        errors,
      );
      if (parsed) items.push(parsed);
    });
  } else if (format === "jsonl") {
    const lines = text.split(/\r?\n/);
    let count = 0;
    lines.forEach((line, lineIndex) => {
      if (!line.trim()) return;
      count += 1;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        errors.push(`第 ${lineIndex + 1} 行不是合法的 JSON`);
        return;
      }
      const parsed = parseObject(value, count, errors);
      if (parsed) items.push(parsed);
    });
  } else {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return { items: [], errors: ["内容不是合法的 JSON 数组"] };
    }
    if (!Array.isArray(value)) return { items: [], errors: ["内容不是合法的 JSON 数组"] };
    value.forEach((entry, index) => {
      const parsed = parseObject(entry, index + 1, errors);
      if (parsed) items.push(parsed);
    });
  }
  if (items.length > ITEM_LIMIT) errors.push("最多 500 条");
  return { items: errors.length > 0 ? [] : items, errors };
}
