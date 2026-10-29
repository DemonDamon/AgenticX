import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SAMPLE_RULES, type ExecutionRow, type RuleRow } from "./rules-types";

export type { ExecutionRow, RuleRow } from "./rules-types";
export { SAMPLE_RULES } from "./rules-types";

type RulesFile = { rules: RuleRow[] };
type ExecutionsFile = { executions: ExecutionRow[] };

function storeDir(): string {
  const env = process.env.AGX_RULES_STORE_DIR?.trim();
  if (env) return env;
  return path.resolve(process.cwd(), "../../.runtime/admin/rules");
}

function rulesPath(): string {
  return path.join(storeDir(), "rules.json");
}

function executionsPath(): string {
  return path.join(storeDir(), "executions.json");
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

async function ensureRulesSeed(): Promise<RulesFile> {
  const file = rulesPath();
  try {
    await readFile(file, "utf-8");
    return await readJsonFile<RulesFile>(file, { rules: [...SAMPLE_RULES] });
  } catch {
    const seeded: RulesFile = {
      rules: SAMPLE_RULES.map((r) => ({ ...r, body: { ...r.body }, meta: { ...r.meta } })),
    };
    await writeJsonFile(file, seeded);
    return seeded;
  }
}

export async function listRules(): Promise<RuleRow[]> {
  const data = await ensureRulesSeed();
  return (data.rules ?? []).slice().sort((a, b) => a.id.localeCompare(b.id));
}

export async function getRule(ruleId: string): Promise<RuleRow | null> {
  const rules = await listRules();
  return rules.find((r) => r.id === ruleId) ?? null;
}

export async function listExecutions(ruleId?: string): Promise<ExecutionRow[]> {
  const data = await readJsonFile<ExecutionsFile>(executionsPath(), { executions: [] });
  let rows = data.executions ?? [];
  if (ruleId) rows = rows.filter((r) => r.rule_id === ruleId);
  return rows.slice().sort((a, b) => a.id.localeCompare(b.id));
}
