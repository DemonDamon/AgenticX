import { describe, expect, it } from "vitest";

import {
  AgentUsageService,
  agentQuotaWindowStarts,
  type AgentUsageQueryInput,
} from "../src/services/agent-usage";
import { postgresqlMeteringSql, type SqlExecutor } from "../src/services/sql";

function recordingExecutor(rows: Record<string, unknown>[]) {
  const calls: Array<{ statement: string; params: unknown[] }> = [];
  const executor: SqlExecutor = {
    async query(statement, params) {
      calls.push({ statement, params: params ?? [] });
      return { rows, rowCount: rows.length };
    },
  };
  return { executor, calls };
}

describe("agent usage query", () => {
  it("groups managed-session usage by agent and local day", async () => {
    const { executor, calls } = recordingExecutor([
      {
        agent: "A",
        agent_name: "Alpha",
        day: "2026-10-26",
        input_tokens: "3",
        output_tokens: "5",
        total_tokens: "8",
        cache_read_input_tokens: "0",
        requests: "1",
        sessions: "1",
      },
    ]);
    const service = new AgentUsageService({
      executor,
      sql: postgresqlMeteringSql,
      timeZone: "Asia/Shanghai",
    });
    const input: AgentUsageQueryInput = {
      tenant_id: "T",
      start: "2026-10-01T00:00:00.000Z",
      end: "2026-10-31T00:00:00.000Z",
      agent_id: ["A", "B"],
      group_by: ["agent", "day"],
    };
    const result = await service.query(input);
    const sql = calls[0]?.statement ?? "";
    expect(sql).toContain("FROM ma_session_usage u");
    expect(sql).toContain("a.display_name AS agent_name");
    expect(sql).toContain("GROUP BY");
    expect(sql).toContain("u.agent_id");
    expect(sql).not.toContain("usage_records");
    expect(sql.toLowerCase()).toContain("u.agent_id in (");
    expect(calls[0]?.params).toEqual(expect.arrayContaining(["A", "B"]));
    expect(result.rows[0]).toMatchObject({
      input_tokens: 3,
      output_tokens: 5,
      total_tokens: 8,
      requests: 1,
      sessions: 1,
    });
    expect(result.rows[0]?.dims.day).toBe("2026-10-26");
    expect(typeof result.rows[0]?.input_tokens).toBe("number");
  });

  it("uses the same Asia/Shanghai windows as the runtime", () => {
    const sunday = agentQuotaWindowStarts(new Date("2026-10-25T13:00:00.000Z"), "Asia/Shanghai");
    expect(sunday.day.toISOString()).toBe("2026-10-24T16:00:00.000Z");
    expect(sunday.week.toISOString()).toBe("2026-10-18T16:00:00.000Z");
    expect(sunday.month.toISOString()).toBe("2026-09-30T16:00:00.000Z");

    const nextSunday = agentQuotaWindowStarts(new Date("2026-11-01T05:00:00.000Z"), "Asia/Shanghai");
    expect(nextSunday.week.toISOString()).toBe("2026-10-25T16:00:00.000Z");

    const crossed = agentQuotaWindowStarts(new Date("2026-10-25T16:30:00.000Z"), "Asia/Shanghai");
    expect(crossed.day.toISOString()).toBe("2026-10-25T16:00:00.000Z");
    const label = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(crossed.day);
    expect(label).toBe("2026-10-26");
  });
});
