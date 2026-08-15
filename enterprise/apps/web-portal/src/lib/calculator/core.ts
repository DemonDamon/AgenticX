import DecimalJs from "decimal.js";

// Covers the worst allowed exact product (16 operands × 80-character literals)
// with headroom, while approximate division is shortened before it leaves here.
const Decimal = DecimalJs.clone({ precision: 1_400 });

const MAX_CALCULATIONS = 8;
const MAX_OPERANDS = 16;
const MAX_LITERAL_CHARS = 80;
const MAX_DECIMAL_EXPONENT = 100;
const DISPLAY_SIGNIFICANT_DIGITS = 15;

const PLAIN_DECIMAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
const GROUPED_DECIMAL_RE = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u;

export const CALCULATOR_OPERATIONS = [
  "sum",
  "difference",
  "product",
  "quotient",
  "average",
  "percent_of",
  "percentage_change",
] as const;

export type CalculatorOperation = (typeof CALCULATOR_OPERATIONS)[number];

export type CalculatorRequest = {
  id: string;
  operation: CalculatorOperation;
  operands: string[];
};

export type CalculatorResult = {
  id: string;
  operation: CalculatorOperation | "unknown";
  status: "ok" | "rejected";
  operands: string[];
  value?: string;
  displayValue?: string;
  precision: "exact_decimal" | "approximate";
  error?: string;
};

function isCalculatorOperation(value: unknown): value is CalculatorOperation {
  return (
    typeof value === "string" &&
    (CALCULATOR_OPERATIONS as readonly string[]).includes(value)
  );
}

function decimalLiteral(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) return null;
    value = String(value);
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > MAX_LITERAL_CHARS) return null;
  if (GROUPED_DECIMAL_RE.test(raw)) return raw.replaceAll(",", "");
  return PLAIN_DECIMAL_RE.test(raw) ? raw : null;
}

function parseDecimal(value: unknown): InstanceType<typeof Decimal> | null {
  const literal = decimalLiteral(value);
  if (!literal) return null;
  try {
    const parsed = new Decimal(literal);
    const exponent = parsed.e ?? 0;
    if (!parsed.isFinite() || Math.abs(exponent) > MAX_DECIMAL_EXPONENT) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The canonical value of a numeric literal, or null if it is not one.
 *
 * Comparing by value rather than by spelling is what lets "1,234.56", "1234.56"
 * and "1234.560" anchor to each other while "1234.65" does not.
 */
export function canonicalDecimal(value: unknown): string | null {
  const parsed = parseDecimal(value);
  return parsed ? plain(parsed) : null;
}

function trimDecimal(text: string): string {
  if (!text.includes(".")) return text === "-0" ? "0" : text;
  const trimmed = text.replace(/\.?0+$/u, "");
  return trimmed === "-0" || !trimmed ? "0" : trimmed;
}

function plain(value: InstanceType<typeof Decimal>): string {
  return trimDecimal(value.toFixed());
}

function display(value: InstanceType<typeof Decimal>): string {
  return trimDecimal(value.toSignificantDigits(DISPLAY_SIGNIFICANT_DIGITS).toFixed());
}

function rejected(
  id: string,
  operation: CalculatorOperation | "unknown",
  operands: string[],
  error: string,
): CalculatorResult {
  return {
    id,
    operation,
    status: "rejected",
    operands,
    precision: "approximate",
    error,
  };
}

function normalizedRequest(raw: unknown, index: number): CalculatorRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (!isCalculatorOperation(row.operation) || !Array.isArray(row.operands)) return null;
  if (row.operands.length === 0 || row.operands.length > MAX_OPERANDS) return null;
  const operands = row.operands.map(decimalLiteral);
  if (operands.some((value) => value === null)) return null;
  const rawId = typeof row.id === "string" ? row.id.trim() : "";
  return {
    id: (rawId || `calc_${index + 1}`).slice(0, 64),
    operation: row.operation,
    operands: operands as string[],
  };
}

function validateArity(request: CalculatorRequest): string | null {
  const count = request.operands.length;
  if (["difference", "quotient", "percent_of", "percentage_change"].includes(request.operation)) {
    return count === 2 ? null : `${request.operation} requires exactly 2 operands`;
  }
  return count >= 2 ? null : `${request.operation} requires at least 2 operands`;
}

export function executeCalculatorRequest(request: CalculatorRequest): CalculatorResult {
  const arityError = validateArity(request);
  if (arityError) return rejected(request.id, request.operation, request.operands, arityError);

  const values = request.operands.map(parseDecimal);
  if (values.some((value) => value === null)) {
    return rejected(request.id, request.operation, request.operands, "invalid decimal operand");
  }
  const decimals = values as Array<InstanceType<typeof Decimal>>;

  try {
    let result: InstanceType<typeof Decimal>;
    let precision: CalculatorResult["precision"] = "exact_decimal";

    switch (request.operation) {
      case "sum":
        result = decimals.reduce((total, value) => total.plus(value), new Decimal(0));
        break;
      case "difference":
        result = decimals[0]!.minus(decimals[1]!);
        break;
      case "product":
        result = decimals.reduce((total, value) => total.times(value), new Decimal(1));
        break;
      case "quotient":
        if (decimals[1]!.isZero()) {
          return rejected(request.id, request.operation, request.operands, "division by zero");
        }
        result = decimals[0]!.dividedBy(decimals[1]!);
        precision = "approximate";
        break;
      case "average":
        result = decimals
          .reduce((total, value) => total.plus(value), new Decimal(0))
          .dividedBy(decimals.length);
        precision = "approximate";
        break;
      case "percent_of":
        // operands: [percentage, base value], e.g. ["12.5", "800"] => 100.
        result = decimals[1]!.times(decimals[0]!).dividedBy(100);
        break;
      case "percentage_change":
        // operands: [old value, new value], result is percentage points.
        if (decimals[0]!.isZero()) {
          return rejected(
            request.id,
            request.operation,
            request.operands,
            "percentage change from zero is undefined",
          );
        }
        result = decimals[1]!.minus(decimals[0]!).dividedBy(decimals[0]!.abs()).times(100);
        precision = "approximate";
        break;
    }

    const exponent = result.e ?? 0;
    if (!result.isFinite() || Math.abs(exponent) > MAX_DECIMAL_EXPONENT) {
      return rejected(request.id, request.operation, request.operands, "result magnitude is unsupported");
    }

    const shown = display(result);
    return {
      id: request.id,
      operation: request.operation,
      status: "ok",
      operands: request.operands,
      value: precision === "exact_decimal" ? plain(result) : shown,
      displayValue: request.operation === "percentage_change" ? `${shown}%` : shown,
      precision,
    };
  } catch {
    return rejected(request.id, request.operation, request.operands, "calculation failed");
  }
}

/**
 * Execute a model-produced calculator batch. Invalid entries are rejected per item;
 * malformed top-level payloads produce an empty result instead of throwing.
 */
export function executeCalculatorBatch(raw: unknown): CalculatorResult[] {
  const rows =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).calculations
      : null;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_CALCULATIONS) return [];

  return rows.map((row, index) => {
    const request = normalizedRequest(row, index);
    if (request) return executeCalculatorRequest(request);
    return rejected(`calc_${index + 1}`, "unknown", [], "invalid calculator request");
  });
}
