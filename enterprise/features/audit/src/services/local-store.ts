import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AuditActor, AuditEvent, AuditQueryInput, AuditQueryResult, AuditStore } from "../types";

function computeChecksum(event: AuditEvent): string {
  const clone = { ...event, checksum: "" };
  const hash = createHash("blake2b512");
  hash.update(`${event.prev_checksum}|${JSON.stringify(clone)}`);
  return hash.digest("hex").slice(0, 64);
}

function normalizeActorScope(actor: AuditActor): "auditor" | "dept-admin" | "member" {
  if (actor.scopes.includes("audit:read:all") || actor.scopes.includes("audit:read")) {
    return "auditor";
  }
  if (actor.scopes.includes("audit:read:dept")) {
    return "dept-admin";
  }
  return "member";
}

function toCsv(items: AuditEvent[]): string {
  const header = [
    "id",
    "tenant_id",
    "event_time",
    "event_type",
    "user_id",
    "department_id",
    "provider",
    "model",
    "route",
    "total_tokens",
    "latency_ms",
    "checksum",
  ];
  const rows = items.map((item) =>
    [
      item.id,
      item.tenant_id,
      item.event_time,
      item.event_type,
      item.user_id ?? "",
      item.department_id ?? "",
      item.provider ?? "",
      item.model ?? "",
      item.route,
      String(item.total_tokens ?? 0),
      String(item.latency_ms ?? 0),
      item.checksum,
    ]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

export class LocalAuditStore implements AuditStore {
  private readonly dir: string;

  public constructor(dir: string) {
    this.dir = dir;
  }

  private async readAllEvents(): Promise<AuditEvent[]> {
    let files: string[];
    try {
      files = await fs.readdir(this.dir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return [];
      }
      throw error;
    }
    const jsonlFiles = files.filter((file) => file.endsWith(".jsonl")).sort();
    const items: AuditEvent[] = [];
    for (const file of jsonlFiles) {
      const fullPath = path.join(this.dir, file);
      const content = await fs.readFile(fullPath, "utf-8");
      const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        if (!line) continue;
        try {
          items.push(JSON.parse(line) as AuditEvent);
        } catch {
          throw new Error(`invalid audit json line at ${file}:${lineIndex + 1}`);
        }
      }
    }
    return items;
  }

  private checkChain(items: AuditEvent[]): boolean {
    let prev = "GENESIS";
    let index = 0;
    for (const current of items) {
      if (index > 0 && current.prev_checksum === "GENESIS") return false;
      if (current.prev_checksum !== prev) return false;
      if (computeChecksum(current) !== current.checksum) return false;
      prev = current.checksum;
      index += 1;
    }
    return true;
  }

  private canReadEvent(actor: AuditActor, event: AuditEvent): boolean {
    if (actor.tenantId !== event.tenant_id) return false;
    const scope = normalizeActorScope(actor);
    if (scope === "auditor") return true;
    if (scope === "dept-admin") {
      return !!actor.deptId && actor.deptId === event.department_id;
    }
    return actor.userId === event.user_id;
  }

  public async query(actor: AuditActor, input: AuditQueryInput): Promise<AuditQueryResult> {
    const events = await this.readAllEvents();
    const chainValid = this.checkChain(events);
    const start = input.start ? Date.parse(input.start) : Number.NEGATIVE_INFINITY;
    const end = input.end ? Date.parse(input.end) : Number.POSITIVE_INFINITY;

    const filtered = events.filter((event) => {
      if (!this.canReadEvent(actor, event)) return false;
      if (input.user_id && event.user_id !== input.user_id) return false;
      if (input.department_id && event.department_id !== input.department_id) return false;
      if (input.provider && event.provider !== input.provider) return false;
      if (input.model && event.model !== input.model) return false;
      if (input.policy_hit) {
        const has = event.policies_hit?.some((item) => item.policy_id === input.policy_hit);
        if (!has) return false;
      }
      const eventTime = Date.parse(event.event_time);
      if (eventTime < start || eventTime > end) return false;
      return true;
    });

    const offset = Math.max(input.offset ?? 0, 0);
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 1000);
    return {
      total: filtered.length,
      items: filtered.slice(offset, offset + limit),
      chain_valid: chainValid,
    };
  }

  public async exportCsv(actor: AuditActor, input: AuditQueryInput): Promise<string> {
    const result = await this.query(actor, input);
    return toCsv(result.items);
  }
}

