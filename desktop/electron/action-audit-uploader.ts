/**
 * Drain ~/.agenticx/action_audit/outbox.jsonl to the enterprise portal.
 *
 * Rename-then-upload keeps lines that Python appends during a flush. A 400
 * drops that batch; 401/403 and transport failures leave the remainder on disk.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const FLUSH_INTERVAL_MS = 60_000;
const BATCH_SIZE = 200;
const REQUEST_TIMEOUT_MS = 15_000;

export type ActionAuditConfig = {
  enterprise?: {
    enabled?: boolean;
    token?: string;
    base_url?: string;
  };
};

export type ActionAuditUploaderDeps = {
  loadConfig: () => ActionAuditConfig;
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  /** Resolved AgenticX data root (same as ``getAgxHomeDir()``). */
  agxHome: string;
  now: () => number;
};

export type FlushResult = {
  skipped?: boolean;
  sent: number;
  dropped: number;
  pending: number;
};

type ParsedLine = {
  raw: string;
  value: unknown;
};

function auditDir(agxHome: string): string {
  return path.join(agxHome, "action_audit");
}

function nonEmptyLines(text: string): string[] {
  return text.split(/\n/).filter((line) => line.trim().length > 0);
}

function readLines(file: string): string[] {
  try {
    return nonEmptyLines(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

function rewriteLines(file: string, lines: string[]): void {
  const tmp = `${file}.tmp`;
  const body = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  fs.writeFileSync(tmp, body, "utf-8");
  fs.renameSync(tmp, file);
}

function parseLines(lines: string[]): { valid: ParsedLine[]; dropped: number } {
  const valid: ParsedLine[] = [];
  let dropped = 0;
  for (const raw of lines) {
    try {
      valid.push({ raw, value: JSON.parse(raw) as unknown });
    } catch {
      dropped += 1;
    }
  }
  return { valid, dropped };
}

function sendingFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith("sending-") && name.endsWith(".jsonl"))
    .sort()
    .map((name) => path.join(dir, name));
}

function claimOutbox(dir: string, now: number): void {
  const outbox = path.join(dir, "outbox.jsonl");
  if (!fs.existsSync(outbox)) return;
  let size = 0;
  try {
    size = fs.statSync(outbox).size;
  } catch {
    return;
  }
  if (size <= 0) return;
  let target = path.join(dir, `sending-${now}.jsonl`);
  if (fs.existsSync(target)) {
    target = path.join(dir, `sending-${now}-${process.pid}.jsonl`);
  }
  fs.renameSync(outbox, target);
}

function enterpriseTarget(cfg: ActionAuditConfig): { token: string; base: string } | null {
  const enterprise = cfg.enterprise;
  if (enterprise?.enabled !== true) return null;
  const token = String(enterprise.token ?? "").trim();
  const base = String(enterprise.base_url ?? "").trim().replace(/\/+$/, "");
  if (!token || !base) return null;
  return { token, base };
}

export async function flushActionAuditOnce(deps: ActionAuditUploaderDeps): Promise<FlushResult> {
  let cfg: ActionAuditConfig;
  try {
    cfg = deps.loadConfig() ?? {};
  } catch {
    return { skipped: true, sent: 0, dropped: 0, pending: 0 };
  }
  const target = enterpriseTarget(cfg);
  if (!target) {
    return { skipped: true, sent: 0, dropped: 0, pending: 0 };
  }

  const dir = auditDir(deps.agxHome);
  if (!fs.existsSync(dir)) {
    return { sent: 0, dropped: 0, pending: 0 };
  }
  try {
    claimOutbox(dir, deps.now());
  } catch (error) {
    console.warn(`[action-audit] failed to claim outbox: ${String(error)}`);
    return { sent: 0, dropped: 0, pending: 0 };
  }

  const files = sendingFiles(dir);
  let sent = 0;
  let dropped = 0;
  let pending = 0;

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex]!;
    const parsed = parseLines(readLines(file));
    dropped += parsed.dropped;
    const valid = parsed.valid;
    let index = 0;
    let stop: "auth" | "retry" | null = null;

    while (index < valid.length) {
      const batch = valid.slice(index, index + BATCH_SIZE);
      let response: Response;
      try {
        response = await deps.fetchImpl(`${target.base}/api/desktop/action-audit`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${target.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ events: batch.map((item) => item.value) }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        console.warn(`[action-audit] upload failed: ${String(error)}`);
        rewriteLines(file, valid.slice(index).map((item) => item.raw));
        pending += valid.length - index;
        stop = "retry";
        break;
      }

      if (response.status === 400) {
        console.warn(`[action-audit] dropped batch of ${batch.length} events (HTTP 400)`);
        dropped += batch.length;
        index += batch.length;
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        pending += valid.length - index;
        stop = "auth";
        break;
      }
      if (!response.ok) {
        rewriteLines(file, valid.slice(index).map((item) => item.raw));
        pending += valid.length - index;
        stop = "retry";
        break;
      }
      sent += batch.length;
      index += batch.length;
    }

    if (stop === null) {
      try {
        fs.unlinkSync(file);
      } catch (error) {
        console.warn(`[action-audit] failed to remove ${file}: ${String(error)}`);
      }
      continue;
    }

    for (const later of files.slice(fileIndex + 1)) {
      pending += readLines(later).length;
    }
    break;
  }

  return { sent, dropped, pending };
}

export function startActionAuditUploader(deps: ActionAuditUploaderDeps): () => void {
  let stopped = false;
  let inflight = false;
  const run = () => {
    if (stopped || inflight) return;
    inflight = true;
    void flushActionAuditOnce(deps)
      .catch(() => undefined)
      .finally(() => {
        inflight = false;
      });
  };
  run();
  const timer = setInterval(run, FLUSH_INTERVAL_MS);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
