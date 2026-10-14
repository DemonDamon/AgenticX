import { describe, expect, it } from "vitest";
import type { SqlClient, SqlResult } from "../../chat-history/sql-store";
import { SqlWorkerTaskStore } from "../sql-store";
import { WorkerTaskConflictError, type TaskInput } from "../types";

const TENANT = "01TENANT0AAAAAAAAAAAAAAA";
const USER = "01USER0AAAAAAAAAAAAAAAAA";
const OTHER = "01USER1AAAAAAAAAAAAAAAAA";
const AGENT = "01AGENT0AAAAAAAAAAAAAAAA";
const ROOM = "01ROOM0AAAAAAAAAAAAAAAAA";
const DEVICE_A = "device-a1";
const DEVICE_B = "device-b2";

const taskInput: TaskInput = {
  messages: [{ role: "user", name: "Alice", content: "先做这个" }],
  instruction: "先做这个",
};

type TaskRow = {
  id: string;
  tenant_id: string;
  agent_id: string;
  room_id: string;
  trigger_message_id: string;
  requested_by: string;
  status: string;
  input: string;
  attempts: number;
  claimed_by_user_id: string | null;
  claimed_by_device: string | null;
  claimed_at: Date | null;
  lease_expires_at: Date | null;
  completed_at: Date | null;
  result_message_id: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
};

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function createMemory() {
  const tasks: TaskRow[] = [];
  const held = new Map<string, number>();
  const sqlLog: string[] = [];
  let txSeq = 0;
  let overlap = false;
  let overlapArrived = 0;
  let releaseFirst: (() => void) | null = null;

  function pickQueued(tenantId: string, agentIds: readonly string[], tx: number | null): TaskRow | undefined {
    return tasks
      .filter((task) => task.tenant_id === tenantId && task.status === "queued" && agentIds.includes(task.agent_id))
      .filter((task) => {
        const owner = held.get(task.id);
        return owner == null || owner === tx;
      })
      .sort((left, right) => left.created_at.getTime() - right.created_at.getTime() || left.id.localeCompare(right.id))[0];
  }

  async function handle(sqlRaw: string, params: unknown[], tx: number | null): Promise<SqlResult> {
    const sql = normalize(sqlRaw);
    sqlLog.push(sql);

    if (sql.startsWith("insert into enterprise_agent_tasks")) {
      tasks.push({
        id: String(params[0]),
        tenant_id: String(params[1]),
        agent_id: String(params[2]),
        room_id: String(params[3]),
        trigger_message_id: String(params[4]),
        requested_by: String(params[5]),
        status: String(params[6]),
        input: String(params[7]),
        attempts: Number(params[8]),
        claimed_by_user_id: null,
        claimed_by_device: null,
        claimed_at: null,
        lease_expires_at: null,
        completed_at: null,
        result_message_id: null,
        error: null,
        created_at: params[9] as Date,
        updated_at: params[10] as Date,
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("for update skip locked") && sql.includes("returning")) {
      const row = pickQueued(String(params[4]), params[5] as string[], tx);
      if (!row) return { rows: [], rowCount: 0 };
      row.status = "claimed";
      row.claimed_by_user_id = String(params[0]);
      row.claimed_by_device = String(params[1]);
      row.claimed_at = params[2] as Date;
      row.lease_expires_at = params[3] as Date;
      row.updated_at = params[2] as Date;
      return { rows: [row], rowCount: 1 };
    }

    if (sql.includes("for update skip locked") && sql.startsWith("select id")) {
      const tenantId = String(params[0]);
      const agentIds = params.slice(1).map(String);
      if (overlap) {
        overlapArrived += 1;
        if (overlapArrived === 1) {
          const row = pickQueued(tenantId, agentIds, tx);
          if (row && tx != null) held.set(row.id, tx);
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
        }
        releaseFirst?.();
      }
      const row = pickQueued(tenantId, agentIds, tx);
      if (row && tx != null) held.set(row.id, tx);
      return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.includes("set status = 'claimed'")) {
      const row = tasks.find(
        (task) => task.id === String(params[5]) && task.tenant_id === String(params[6]) && task.status === "queued",
      );
      if (!row) return { rows: [], rowCount: 0 };
      row.status = "claimed";
      row.claimed_by_user_id = String(params[0]);
      row.claimed_by_device = String(params[1]);
      row.claimed_at = params[2] as Date;
      row.lease_expires_at = params[3] as Date;
      row.updated_at = params[4] as Date;
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("set status = 'completed'")) {
      const row = tasks.find(
        (task) =>
          task.id === String(params[3]) &&
          task.tenant_id === String(params[4]) &&
          task.status === "claimed" &&
          task.claimed_by_user_id === String(params[5]) &&
          task.claimed_by_device === String(params[6]),
      );
      if (!row) return { rows: [], rowCount: 0 };
      row.status = "completed";
      row.result_message_id = String(params[0]);
      row.completed_at = params[1] as Date;
      row.updated_at = params[2] as Date;
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("set status = 'expired'")) {
      const row = tasks.find(
        (task) => task.id === String(params[1]) && task.tenant_id === String(params[2]) && task.status === "queued",
      );
      if (!row) return { rows: [], rowCount: 0 };
      row.status = "expired";
      row.updated_at = params[0] as Date;
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("set status = 'queued'")) {
      const row = tasks.find(
        (task) => task.id === String(params[2]) && task.tenant_id === String(params[3]) && task.status === "claimed",
      );
      if (!row) return { rows: [], rowCount: 0 };
      row.status = "queued";
      row.attempts = Number(params[0]);
      row.claimed_by_user_id = null;
      row.claimed_by_device = null;
      row.claimed_at = null;
      row.lease_expires_at = null;
      row.updated_at = params[1] as Date;
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("set status = 'failed'")) {
      if (sql.includes("attempts =")) {
        const row = tasks.find(
          (task) => task.id === String(params[3]) && task.tenant_id === String(params[4]) && task.status === "claimed",
        );
        if (!row) return { rows: [], rowCount: 0 };
        row.status = "failed";
        row.attempts = Number(params[0]);
        row.error = String(params[1]);
        row.updated_at = params[2] as Date;
        return { rows: [], rowCount: 1 };
      }
      const row = tasks.find(
        (task) =>
          task.id === String(params[2]) &&
          task.tenant_id === String(params[3]) &&
          task.status === "claimed" &&
          task.claimed_by_user_id === String(params[4]) &&
          task.claimed_by_device === String(params[5]),
      );
      if (!row) return { rows: [], rowCount: 0 };
      row.status = "failed";
      row.error = String(params[0]);
      row.updated_at = params[1] as Date;
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith("select") && sql.includes("lease_expires_at <")) {
      const now = params[1] as Date;
      const rows = tasks.filter(
        (task) =>
          task.tenant_id === String(params[0]) &&
          task.status === "claimed" &&
          task.lease_expires_at != null &&
          task.lease_expires_at.getTime() < now.getTime(),
      );
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith("select") && sql.includes("created_at <")) {
      const cutoff = params[1] as Date;
      const rows = tasks.filter(
        (task) =>
          task.tenant_id === String(params[0]) &&
          task.status === "queued" &&
          task.created_at.getTime() < cutoff.getTime(),
      );
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith("select") && sql.includes("where id =")) {
      const row = tasks.find((task) => task.id === String(params[0]) && task.tenant_id === String(params[1]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    throw new Error(`unhandled sql: ${sql}`);
  }

  function clientFor(tx: number | null): SqlClient {
    return {
      query(statement, params = []) {
        return handle(statement, params, tx);
      },
      async transaction(callback) {
        const id = ++txSeq;
        try {
          return await callback(clientFor(id));
        } finally {
          for (const [rowId, owner] of [...held.entries()]) {
            if (owner === id) held.delete(rowId);
          }
        }
      },
      close() {},
    };
  }

  return {
    tasks,
    sqlLog,
    client: clientFor(null),
    armOverlap() {
      overlap = true;
      overlapArrived = 0;
      releaseFirst = null;
    },
  };
}

function storeFor(dialect: "mysql" | "postgresql", memory = createMemory()) {
  return { memory, store: new SqlWorkerTaskStore(dialect, memory.client) };
}

async function enqueue(store: SqlWorkerTaskStore, instruction = "先做这个") {
  return store.enqueueAgentTask({
    tenantId: TENANT,
    agentId: AGENT,
    roomId: ROOM,
    triggerMessageId: "01MSG0AAAAAAAAAAAAAAAAAA",
    requestedBy: USER,
    input: { ...taskInput, instruction },
  });
}

describe("SqlWorkerTaskStore", () => {
  it("claims the oldest queued task first", async () => {
    const { memory, store } = storeFor("mysql");
    const older = await enqueue(store, "older");
    const newer = await enqueue(store, "newer");
    const now = Date.now();
    memory.tasks[0]!.created_at = new Date(now - 2 * 60 * 1000);
    memory.tasks[1]!.created_at = new Date(now - 60 * 1000);

    const first = await store.claimNextTask({
      tenantId: TENANT,
      userId: USER,
      deviceId: DEVICE_A,
      agentIds: [AGENT],
    });
    const second = await store.claimNextTask({
      tenantId: TENANT,
      userId: USER,
      deviceId: DEVICE_A,
      agentIds: [AGENT],
    });

    expect(first?.id).toBe(older.id);
    expect(second?.id).toBe(newer.id);
    expect(first?.status).toBe("claimed");
    expect(first?.claimedByDevice).toBe(DEVICE_A);
    expect(memory.sqlLog.some((sql) => sql.includes("for update skip locked"))).toBe(true);
  });

  it("lets only one of two concurrent claims take the same task", async () => {
    const { memory, store } = storeFor("mysql");
    const queued = await enqueue(store);
    memory.armOverlap();
    const [left, right] = await Promise.all([
      store.claimNextTask({ tenantId: TENANT, userId: USER, deviceId: DEVICE_A, agentIds: [AGENT] }),
      store.claimNextTask({ tenantId: TENANT, userId: OTHER, deviceId: DEVICE_B, agentIds: [AGENT] }),
    ]);
    const won = [left, right].filter((task) => task != null);
    expect(won).toHaveLength(1);
    expect(won[0]?.id).toBe(queued.id);
    expect(memory.tasks.filter((task) => task.status === "claimed")).toHaveLength(1);
    expect(memory.sqlLog.some((sql) => sql.includes("for update skip locked"))).toBe(true);
  });

  it("rejects complete from a different device", async () => {
    const { memory, store } = storeFor("mysql");
    const queued = await enqueue(store);
    await store.claimNextTask({ tenantId: TENANT, userId: USER, deviceId: DEVICE_A, agentIds: [AGENT] });
    await expect(
      store.completeTask({
        tenantId: TENANT,
        userId: USER,
        deviceId: DEVICE_B,
        taskId: queued.id,
        resultMessageId: "01RESULT0AAAAAAAAAAAAAAA",
      }),
    ).rejects.toBeInstanceOf(WorkerTaskConflictError);
    expect(memory.tasks[0]?.status).toBe("claimed");
  });

  it("requeues an expired lease and fails the task on the third expiry", async () => {
    const { memory, store } = storeFor("mysql");
    await enqueue(store);
    await store.claimNextTask({ tenantId: TENANT, userId: USER, deviceId: DEVICE_A, agentIds: [AGENT] });
    const row = memory.tasks[0]!;
    row.lease_expires_at = new Date(Date.now() - 60_000);

    const requeued = await store.sweepExpired(TENANT);
    expect(requeued).toEqual([]);
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(1);
    expect(row.claimed_by_device).toBeNull();

    row.status = "claimed";
    row.attempts = 2;
    row.lease_expires_at = new Date(Date.now() - 60_000);
    row.claimed_by_user_id = USER;
    row.claimed_by_device = DEVICE_A;
    const failed = await store.sweepExpired(TENANT);
    expect(failed.map((task) => task.status)).toEqual(["failed"]);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(3);
    expect(row.error).toBe("多次领取未完成");
  });

  it("expires a task that stayed queued for 24 hours", async () => {
    const { memory, store } = storeFor("mysql");
    const queued = await enqueue(store);
    memory.tasks[0]!.created_at = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const swept = await store.sweepExpired(TENANT);
    expect(swept.map((task) => ({ id: task.id, status: task.status }))).toEqual([
      { id: queued.id, status: "expired" },
    ]);
    expect(memory.tasks[0]?.status).toBe("expired");
  });

  it("claims with one skip-locked statement on postgresql", async () => {
    const { memory, store } = storeFor("postgresql");
    const queued = await enqueue(store);
    const claimed = await store.claimNextTask({
      tenantId: TENANT,
      userId: USER,
      deviceId: DEVICE_A,
      agentIds: [AGENT],
    });
    expect(claimed?.id).toBe(queued.id);
    expect(claimed?.status).toBe("claimed");
    const claimSql = memory.sqlLog.find((sql) => sql.includes("for update skip locked"));
    expect(claimSql).toContain("returning");
    expect(claimSql).toContain("any(");
  });
});
