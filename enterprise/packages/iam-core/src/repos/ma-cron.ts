/** Five-field cron validation shared by the schedule control plane. No timezone math. */

export const CRON_FIELD_NAMES = ["minute", "hour", "day_of_month", "month", "day_of_week"] as const;

export type CronFieldName = (typeof CRON_FIELD_NAMES)[number];

export class MaCronValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaCronValidationError";
  }
}

export type ParsedCron = {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
  domRestricted: boolean;
  dowRestricted: boolean;
};

type FieldSpec = { name: CronFieldName; min: number; max: number };

const FIELD_SPECS: readonly FieldSpec[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day_of_month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day_of_week", min: 0, max: 7 },
];

function invalid(name: CronFieldName): MaCronValidationError {
  return new MaCronValidationError(`cron: ${name} is invalid`);
}

function parseStep(text: string, name: CronFieldName): number {
  if (!/^\d{1,2}$/.test(text)) throw invalid(name);
  const step = Number(text);
  if (step < 1 || step > 59) throw invalid(name);
  return step;
}

function rangeValues(start: number, end: number, step: number, spec: FieldSpec): number[] {
  const out: number[] = [];
  for (let value = start; value <= end; value += step) out.push(value);
  if (out.length === 0) throw invalid(spec.name);
  return out;
}

function expandItem(item: string, spec: FieldSpec): number[] {
  if (item === "*") return rangeValues(spec.min, spec.max, 1, spec);
  if (item.startsWith("*/")) return rangeValues(spec.min, spec.max, parseStep(item.slice(2), spec.name), spec);

  const slash = item.indexOf("/");
  const rangePart = slash >= 0 ? item.slice(0, slash) : item;
  const step = slash >= 0 ? parseStep(item.slice(slash + 1), spec.name) : 1;
  const match = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(rangePart);
  if (!match) throw invalid(spec.name);
  const startText = match[1];
  if (startText === undefined) throw invalid(spec.name);
  const start = Number(startText);
  const endText = match[2];
  const end = endText === undefined ? (slash >= 0 ? spec.max : start) : Number(endText);
  if (endText !== undefined && start > end) throw invalid(spec.name);
  if (start < spec.min || start > spec.max || end < spec.min || end > spec.max) throw invalid(spec.name);
  if (slash < 0 && endText === undefined) return [start];
  return rangeValues(start, end, step, spec);
}

function expandField(field: string, spec: FieldSpec): number[] {
  if (!field) throw invalid(spec.name);
  const values = new Set<number>();
  for (const item of field.split(",")) {
    if (!item) throw invalid(spec.name);
    for (const value of expandItem(item, spec)) values.add(value);
  }
  return [...values].sort((left, right) => left - right);
}

/** Parse a 5-field cron expression. day_of_week 7 is folded to 0. */
export function parseCron(expr: string): ParsedCron {
  if (typeof expr !== "string") throw new MaCronValidationError("cron: expected 5 fields");
  const fields = expr.trim().split(/ +/);
  if (fields.length !== 5) throw new MaCronValidationError("cron: expected 5 fields");
  const expanded = FIELD_SPECS.map((spec, index) => {
    const field = fields[index];
    if (field === undefined) throw new MaCronValidationError("cron: expected 5 fields");
    return expandField(field, spec);
  });
  const minute = expanded[0];
  const hour = expanded[1];
  const dayOfMonth = expanded[2];
  const month = expanded[3];
  const rawDow = expanded[4];
  if (!minute || !hour || !dayOfMonth || !month || !rawDow) {
    throw new MaCronValidationError("cron: expected 5 fields");
  }
  if (minute.length > 12) {
    throw new MaCronValidationError("cron: minute field fires more than 12 times per hour");
  }
  const dayOfWeek = [...new Set(rawDow.map((value) => (value === 7 ? 0 : value)))].sort((left, right) => left - right);
  const domField = fields[2];
  const dowField = fields[4];
  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    domRestricted: domField !== "*",
    dowRestricted: dowField !== "*",
  };
}

/** Return the original IANA name. Throws when the runtime cannot resolve it. */
export function validateTimezone(tz: string): string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) {
    throw new MaCronValidationError("timezone: unknown time zone");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new MaCronValidationError("timezone: unknown time zone");
  }
  return tz;
}
