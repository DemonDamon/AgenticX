/**
 * Admin NL2SQL adapter (W4): mirrors W2 explain|execute + write-gate codes.
 * Default backend=fixture (hermetic UI/Playwright). Set AGX_NL2SQL_BACKEND=python
 * to call `python -m agenticx.managed.templates.data_suite.nl2sql_cli`.
 */
import { spawn } from "node:child_process";
import path from "node:path";

export const CODE_WRITE_GUARD_DENIED = "write_guard_denied";
export const CODE_INVALID_QUERY_MODE = "invalid_query_mode";
export const CODE_EXPLAIN_ONLY_NO_EXECUTE = "explain_only_no_execute";

export type Nl2SqlMode = "explain" | "execute";

export type Nl2SqlAdminResult = {
  sql: string;
  rows: Array<Record<string, unknown>>;
  refused: boolean;
  reason: string | null;
  mode: string;
  executed: boolean;
  code: string | null;
  channel_calls?: string[];
  backend: "fixture" | "python";
};

export type Nl2SqlAdminRequest = {
  question: string;
  mode?: string | null;
  /** Optional forced SQL (demo / denial path); otherwise drafted from question. */
  sql?: string | null;
};

const WRITE_HEAD =
  /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|MERGE|GRANT|REVOKE)\b/i;
const SELECT_HEAD = /^\s*(WITH\b[\s\S]+)?SELECT\b/i;

export function isReadOnlySql(sql: string): boolean {
  const text = (sql || "").trim();
  if (!text) return false;
  const stripped = text.replace(/;\s*$/, "");
  if (stripped.includes(";")) return false;
  if (WRITE_HEAD.test(text)) return false;
  return SELECT_HEAD.test(text);
}

export function normalizeQueryMode(mode: string | null | undefined): string {
  if (mode == null) return "execute";
  const text = String(mode).trim().toLowerCase();
  return text || "execute";
}

export function decideQueryMode(mode: string | null | undefined): {
  allowed: boolean;
  code: string;
  reason: string;
} {
  const resolved = normalizeQueryMode(mode);
  if (resolved === "explain" || resolved === "execute") {
    return { allowed: true, code: "", reason: "" };
  }
  return {
    allowed: false,
    code: CODE_INVALID_QUERY_MODE,
    reason: `${CODE_INVALID_QUERY_MODE}: ${resolved}`,
  };
}

/** Stable Chinese copy for denial codes (UI; no EN mix). */
export function denialReasonZh(code: string | null | undefined, reason: string | null | undefined): string {
  const c = (code || "").trim();
  if (c === CODE_WRITE_GUARD_DENIED || (reason || "").includes(CODE_WRITE_GUARD_DENIED)) {
    return "写闸已拒绝：SQL 非只读，未执行";
  }
  if (c === CODE_INVALID_QUERY_MODE || (reason || "").includes(CODE_INVALID_QUERY_MODE)) {
    return "无效查询模式：仅支持「讲解」或「执行」";
  }
  if (c === CODE_EXPLAIN_ONLY_NO_EXECUTE || (reason || "").includes(CODE_EXPLAIN_ONLY_NO_EXECUTE)) {
    return "当前为讲解模式，未执行";
  }
  const r = (reason || "").trim();
  return r || "请求被拒绝";
}

export function draftSqlFromQuestion(question: string, forced?: string | null): string {
  if (forced && forced.trim()) return forced.trim();
  const q = (question || "").trim();
  if (/退货|GMV|华东/i.test(q)) {
    return (
      "SELECT region, gmv, return_rate " +
      "FROM retail_monthly " +
      "WHERE region = '华东' AND month = date_trunc('month', current_date) - interval '1 month'"
    );
  }
  if (/INSERT|删除|写入/i.test(q)) {
    return "INSERT INTO retail_monthly(region, gmv) VALUES ('华东', 0)";
  }
  return "SELECT 1 AS ok";
}

function rowsFor(sql: string): Array<Record<string, unknown>> {
  const upper = sql.toUpperCase();
  if (upper.includes("RETAIL_MONTHLY") || upper.includes("GMV")) {
    return [{ region: "华东", gmv: 12800000, return_rate: 0.032 }];
  }
  return [{ ok: 1 }];
}

function resolveBackend(): "fixture" | "python" {
  const raw = (process.env.AGX_NL2SQL_BACKEND || "").trim().toLowerCase();
  if (raw === "python") return "python";
  return "fixture";
}

async function pythonBridge(req: Nl2SqlAdminRequest): Promise<Nl2SqlAdminResult> {
  const python = process.env.AGX_PYTHON || process.env.PYTHON || "python3";
  const repoHint = process.env.AGX_REPO_ROOT?.trim();
  const cwd = repoHint || path.resolve(process.cwd(), "../..");
  const payload = {
    question: req.question,
    mode: req.mode ?? null,
    sql: req.sql ?? null,
  };
  const res = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(python, ["-m", "agenticx.managed.templates.data_suite.nl2sql_cli"], {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => {
      stdout += String(b);
    });
    child.stderr.on("data", (b) => {
      stderr += String(b);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `nl2sql_cli exit ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
  if (!res.ok) throw new Error(String(res.error || "nl2sql_cli failed"));
  const data = res.data as Nl2SqlAdminResult;
  return { ...data, backend: "python" };
}

export function runFixtureNl2Sql(req: Nl2SqlAdminRequest): Nl2SqlAdminResult {
  const modeDecision = decideQueryMode(req.mode);
  const resolvedMode = normalizeQueryMode(req.mode);
  if (!modeDecision.allowed) {
    return {
      sql: "",
      rows: [],
      refused: true,
      reason: modeDecision.reason,
      mode: resolvedMode,
      executed: false,
      code: modeDecision.code || CODE_INVALID_QUERY_MODE,
      channel_calls: [],
      backend: "fixture",
    };
  }
  const sql = draftSqlFromQuestion(req.question, req.sql);
  if (resolvedMode === "explain") {
    return {
      sql,
      rows: [],
      refused: false,
      reason: null,
      mode: "explain",
      executed: false,
      code: null,
      channel_calls: [],
      backend: "fixture",
    };
  }
  if (!isReadOnlySql(sql)) {
    return {
      sql,
      rows: [],
      refused: true,
      reason: `${CODE_WRITE_GUARD_DENIED}: non-readonly sql`,
      mode: "execute",
      executed: false,
      code: CODE_WRITE_GUARD_DENIED,
      channel_calls: [],
      backend: "fixture",
    };
  }
  const rows = rowsFor(sql);
  return {
    sql,
    rows,
    refused: false,
    reason: null,
    mode: "execute",
    executed: true,
    code: null,
    channel_calls: [sql],
    backend: "fixture",
  };
}

export async function runAdminNl2Sql(req: Nl2SqlAdminRequest): Promise<Nl2SqlAdminResult> {
  const question = (req.question || "").trim();
  if (!question && !(req.sql || "").trim()) {
    throw new Error("question 必填");
  }
  if (resolveBackend() === "python") {
    return pythonBridge({ ...req, question: question || "问数" });
  }
  return runFixtureNl2Sql({ ...req, question: question || "问数" });
}
