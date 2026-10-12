import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  flushActionAuditOnce,
  type ActionAuditUploaderDeps,
} from "../electron/action-audit-uploader";

function eventLine(id: string): string {
  return JSON.stringify({
    v: 1,
    event_id: id.padEnd(32, "a").slice(0, 32),
    ts: "2026-10-12T08:00:00Z",
    kind: "confirm_resolved",
    session_id: "sess",
    agent_id: "meta",
    tool_name: "bash_exec",
    subject: "git:push",
    outcome: "approved",
    decision_source: "human",
    risk: "high",
    args_digest: "ab".repeat(32),
    summary: "push",
  });
}

function harness(now = 1_700_000_000_000): {
  dir: string;
  deps: ActionAuditUploaderDeps;
  fetchImpl: ReturnType<typeof vi.fn>;
} {
  const home = mkdtempSync(path.join(tmpdir(), "action-audit-"));
  const dir = path.join(home, ".agenticx", "action_audit");
  const fetchImpl = vi.fn();
  const deps: ActionAuditUploaderDeps = {
    loadConfig: () => ({
      enterprise: { enabled: true, token: "agx-pat-test", base_url: "https://portal.example" },
    }),
    fetchImpl,
    homeDir: home,
    now: () => now,
  };
  return { dir, deps, fetchImpl };
}

function writeOutbox(dir: string, lines: string[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "outbox.jsonl"), `${lines.join("\n")}\n`, "utf-8");
}

describe("flushActionAuditOnce", () => {
  it("deletes the claimed file after a 2xx response", async () => {
    const { dir, deps, fetchImpl } = harness();
    writeOutbox(dir, [eventLine("1")]);
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ accepted: 1 }), { status: 200 }));

    const result = await flushActionAuditOnce(deps);

    expect(result.sent).toBe(1);
    expect(result.dropped).toBe(0);
    expect(existsSync(path.join(dir, "outbox.jsonl"))).toBe(false);
    expect(readdirSync(dir).filter((name) => name.endsWith(".jsonl"))).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://portal.example/api/desktop/action-audit");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer agx-pat-test");
  });

  it("drops a 400 batch and continues with the next batch", async () => {
    const { dir, deps, fetchImpl } = harness();
    const lines = Array.from({ length: 201 }, (_, index) => eventLine(String(index + 1)));
    writeOutbox(dir, lines);
    fetchImpl
      .mockResolvedValueOnce(new Response("bad", { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: 1 }), { status: 200 }));

    const result = await flushActionAuditOnce(deps);

    expect(result.dropped).toBe(200);
    expect(result.sent).toBe(1);
    expect(result.pending).toBe(0);
    expect(readdirSync(dir).filter((name) => name.endsWith(".jsonl"))).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops on 401 and keeps the file", async () => {
    const { dir, deps, fetchImpl } = harness();
    writeOutbox(dir, [eventLine("1"), eventLine("2")]);
    fetchImpl.mockResolvedValue(new Response("nope", { status: 401 }));

    const result = await flushActionAuditOnce(deps);

    expect(result.sent).toBe(0);
    expect(result.pending).toBe(2);
    const sending = readdirSync(dir).filter((name) => name.startsWith("sending-"));
    expect(sending).toHaveLength(1);
    const kept = readFileSync(path.join(dir, sending[0]!), "utf-8");
    expect(kept).toContain(eventLine("1"));
    expect(kept).toContain(eventLine("2"));
  });

  it("keeps unsent lines when the network fails mid-file", async () => {
    const { dir, deps, fetchImpl } = harness();
    const lines = Array.from({ length: 201 }, (_, index) => eventLine(String(index + 1)));
    writeOutbox(dir, lines);
    fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: 200 }), { status: 200 }))
      .mockRejectedValueOnce(new Error("socket hang up"));

    const result = await flushActionAuditOnce(deps);

    expect(result.sent).toBe(200);
    expect(result.pending).toBe(1);
    const sending = readdirSync(dir).filter((name) => name.startsWith("sending-"));
    expect(sending).toHaveLength(1);
    const kept = readFileSync(path.join(dir, sending[0]!), "utf-8").trim().split("\n");
    expect(kept).toEqual([lines[200]]);
  });

  it("does not lose lines written after the outbox is renamed", async () => {
    const { dir, deps, fetchImpl } = harness();
    writeOutbox(dir, [eventLine("old")]);
    const fresh = `${eventLine("new")}\n`;
    fetchImpl.mockImplementation(async () => {
      writeFileSync(path.join(dir, "outbox.jsonl"), fresh, "utf-8");
      return new Response(JSON.stringify({ accepted: 1 }), { status: 200 });
    });

    const result = await flushActionAuditOnce(deps);

    expect(result.sent).toBe(1);
    expect(readFileSync(path.join(dir, "outbox.jsonl"), "utf-8")).toBe(fresh);
    expect(readdirSync(dir).filter((name) => name.startsWith("sending-"))).toEqual([]);
  });
});
