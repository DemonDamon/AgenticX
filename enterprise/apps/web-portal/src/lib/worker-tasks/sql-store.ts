import { ulid } from "ulid";
import type { SqlClient, SqlDialect } from "../chat-history/sql-store";
import {
  WorkerTaskConflictError,
  type AgentTask,
  type AgentTaskStatus,
  type EnqueueAgentTaskInput,
  type TaskInput,
  type TaskMessage,
} from "./types";

const LEASE_MS = 10 * 60 * 1000;
const QUEUE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const ERROR_MAX = 2000;
const LEASE_EXPIRED_ERROR = "多次领取未完成";

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toIso(value: unknown): string {
  return toDate(value).toISOString();
}

function optionalIso(value: unknown): string | null {
  if (value == null) return null;
  return toIso(value);
}

function parseTaskInput(value: unknown): TaskInput {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      raw = null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { messages: [], instruction: "" };
  }
  const record = raw as { messages?: unknown; instruction?: unknown };
  const messages: TaskMessage[] = [];
  if (Array.isArray(record.messages)) {
    for (const item of record.messages) {
      if (!item || typeof item !== "object") continue;
      const row = item as { role?: unknown; name?: unknown; content?: unknown };
      messages.push({
        role: row.role === "assistant" ? "assistant" : "user",
        name: String(row.name ?? ""),
        content: String(row.content ?? ""),
      });
    }
  }
  return { messages, instruction: String(record.instruction ?? "") };
}

function asStatus(value: unknown): AgentTaskStatus {
  const status = String(value ?? "");
  if (
    status === "queued" ||
    status === "claimed" ||
    status === "completed" ||
    status === "failed" ||
    status === "expired"
  ) {
    return status;
  }
  return "queued";
}

export function mapAgentTask(row: Record<string, unknown>): AgentTask {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    agentId: String(row.agent_id),
    roomId: String(row.room_id),
    triggerMessageId: String(row.trigger_message_id),
    requestedBy: String(row.requested_by),
    status: asStatus(row.status),
    input: parseTaskInput(row.input),
    attempts: Number(row.attempts ?? 0),
    claimedByUserId: row.claimed_by_user_id == null ? null : String(row.claimed_by_user_id),
    claimedByDevice: row.claimed_by_device == null ? null : String(row.claimed_by_device),
    claimedAt: optionalIso(row.claimed_at),
    leaseExpiresAt: optionalIso(row.lease_expires_at),
    completedAt: optionalIso(row.completed_at),
    resultMessageId: row.result_message_id == null ? null : String(row.result_message_id),
    error: row.error == null ? null : String(row.error),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class SqlWorkerTaskStore {
  public constructor(
    private readonly dialect: SqlDialect,
    private readonly client: SqlClient,
  ) {}

  private get p(): boolean {
    return this.dialect === "postgresql";
  }

  private ph(index: number): string {
    return this.p ? `$${index}` : "?";
  }

  public async enqueueAgentTask(input: EnqueueAgentTaskInput): Promise<AgentTask> {
    const id = ulid();
    const now = new Date();
    const task: AgentTask = {
      id,
      tenantId: input.tenantId,
      agentId: input.agentId,
      roomId: input.roomId,
      triggerMessageId: input.triggerMessageId,
      requestedBy: input.requestedBy,
      status: "queued",
      input: input.input,
      attempts: 0,
      claimedByUserId: null,
      claimedByDevice: null,
      claimedAt: null,
      leaseExpiresAt: null,
      completedAt: null,
      resultMessageId: null,
      error: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await this.client.query(
      `insert into enterprise_agent_tasks
        (id, tenant_id, agent_id, room_id, trigger_message_id, requested_by,
         status, input, attempts, created_at, updated_at)
       values (${this.ph(1)}, ${this.ph(2)}, ${this.ph(3)}, ${this.ph(4)}, ${this.ph(5)}, ${this.ph(6)},
               ${this.ph(7)}, ${this.ph(8)}, ${this.ph(9)}, ${this.ph(10)}, ${this.ph(11)})`,
      [
        id,
        input.tenantId,
        input.agentId,
        input.roomId,
        input.triggerMessageId,
        input.requestedBy,
        "queued",
        JSON.stringify(input.input),
        0,
        now,
        now,
      ],
    );
    return task;
  }

  public async hasOnlineWorker(tenantId: string, agentId: string, withinSeconds = 120): Promise<boolean> {
    const since = new Date(Date.now() - withinSeconds * 1000);
    const result = await this.client.query(
      `select id from enterprise_agent_workers
        where tenant_id = ${this.ph(1)}
          and agent_id = ${this.ph(2)}
          and last_heartbeat_at >= ${this.ph(3)}
        limit 1`,
      [tenantId, agentId, since],
    );
    return Boolean(result.rows[0]);
  }

  public async recordHeartbeat(params: {
    tenantId: string;
    userId: string;
    deviceId: string;
    deviceName: string;
    agentIds: string[];
  }): Promise<void> {
    const now = new Date();
    const deviceName = params.deviceName.slice(0, 128);
    const agentIds = [...new Set(params.agentIds.map((id) => id.trim()).filter(Boolean))];
    for (const agentId of agentIds) {
      const id = ulid();
      if (this.p) {
        await this.client.query(
          `insert into enterprise_agent_workers
            (id, tenant_id, agent_id, user_id, device_id, device_name, last_heartbeat_at, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $7, $7)
           on conflict (agent_id, user_id, device_id)
           do update set device_name = excluded.device_name,
                         last_heartbeat_at = excluded.last_heartbeat_at,
                         updated_at = excluded.updated_at`,
          [id, params.tenantId, agentId, params.userId, params.deviceId, deviceName, now],
        );
        continue;
      }
      await this.client.query(
        `insert into enterprise_agent_workers
          (id, tenant_id, agent_id, user_id, device_id, device_name, last_heartbeat_at, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?) as new_row
         on duplicate key update
           device_name = new_row.device_name,
           last_heartbeat_at = new_row.last_heartbeat_at,
           updated_at = new_row.updated_at`,
        [id, params.tenantId, agentId, params.userId, params.deviceId, deviceName, now, now, now],
      );
    }
  }

  public async getAgentTask(tenantId: string, taskId: string): Promise<AgentTask | null> {
    const result = await this.client.query(
      `select * from enterprise_agent_tasks
        where id = ${this.ph(1)} and tenant_id = ${this.ph(2)}
        limit 1`,
      [taskId, tenantId],
    );
    const row = result.rows[0];
    return row ? mapAgentTask(row) : null;
  }

  public async sweepExpired(tenantId: string): Promise<AgentTask[]> {
    const now = new Date();
    const changed: AgentTask[] = [];
    const requeued = new Set<string>();
    const leased = await this.client.query(
      `select * from enterprise_agent_tasks
        where tenant_id = ${this.ph(1)}
          and status = 'claimed'
          and lease_expires_at is not null
          and lease_expires_at < ${this.ph(2)}`,
      [tenantId, now],
    );
    for (const row of leased.rows) {
      const task = mapAgentTask(row);
      const attempts = task.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await this.client.query(
          `update enterprise_agent_tasks
              set status = 'failed',
                  attempts = ${this.ph(1)},
                  error = ${this.ph(2)},
                  updated_at = ${this.ph(3)}
            where id = ${this.ph(4)}
              and tenant_id = ${this.ph(5)}
              and status = 'claimed'`,
          [attempts, LEASE_EXPIRED_ERROR, now, task.id, tenantId],
        );
        changed.push({
          ...task,
          status: "failed",
          attempts,
          error: LEASE_EXPIRED_ERROR,
          updatedAt: now.toISOString(),
        });
        continue;
      }
      await this.client.query(
        `update enterprise_agent_tasks
            set status = 'queued',
                attempts = ${this.ph(1)},
                claimed_by_user_id = null,
                claimed_by_device = null,
                claimed_at = null,
                lease_expires_at = null,
                updated_at = ${this.ph(2)}
          where id = ${this.ph(3)}
            and tenant_id = ${this.ph(4)}
            and status = 'claimed'`,
        [attempts, now, task.id, tenantId],
      );
      requeued.add(task.id);
    }

    const cutoff = new Date(now.getTime() - QUEUE_TTL_MS);
    const stale = await this.client.query(
      `select * from enterprise_agent_tasks
        where tenant_id = ${this.ph(1)}
          and status = 'queued'
          and created_at < ${this.ph(2)}`,
      [tenantId, cutoff],
    );
    for (const row of stale.rows) {
      const task = mapAgentTask(row);
      if (requeued.has(task.id)) continue;
      const updated = await this.client.query(
        `update enterprise_agent_tasks
            set status = 'expired',
                updated_at = ${this.ph(1)}
          where id = ${this.ph(2)}
            and tenant_id = ${this.ph(3)}
            and status = 'queued'`,
        [now, task.id, tenantId],
      );
      if ((updated.rowCount ?? 0) > 0) {
        changed.push({ ...task, status: "expired", updatedAt: now.toISOString() });
      }
    }
    return changed;
  }

  public async claimNextTask(params: {
    tenantId: string;
    userId: string;
    deviceId: string;
    agentIds: string[];
  }): Promise<AgentTask | null> {
    await this.sweepExpired(params.tenantId);
    const agentIds = [...new Set(params.agentIds.map((id) => id.trim()).filter(Boolean))];
    if (agentIds.length === 0) return null;
    if (this.p) return this.claimPostgres({ ...params, agentIds });
    return this.claimMysql({ ...params, agentIds });
  }

  private async claimPostgres(params: {
    tenantId: string;
    userId: string;
    deviceId: string;
    agentIds: string[];
  }): Promise<AgentTask | null> {
    const now = new Date();
    const lease = new Date(now.getTime() + LEASE_MS);
    const result = await this.client.query(
      `with next_task as (
         select id from enterprise_agent_tasks
          where tenant_id = $5
            and status = 'queued'
            and agent_id = any($6::text[])
          order by created_at asc
          limit 1
          for update skip locked
       )
       update enterprise_agent_tasks as task
          set status = 'claimed',
              claimed_by_user_id = $1,
              claimed_by_device = $2,
              claimed_at = $3,
              lease_expires_at = $4,
              updated_at = $3
         from next_task
        where task.id = next_task.id
       returning task.*`,
      [params.userId, params.deviceId, now, lease, params.tenantId, params.agentIds],
    );
    const row = result.rows[0];
    return row ? mapAgentTask(row) : null;
  }

  private async claimMysql(params: {
    tenantId: string;
    userId: string;
    deviceId: string;
    agentIds: string[];
  }): Promise<AgentTask | null> {
    const now = new Date();
    const lease = new Date(now.getTime() + LEASE_MS);
    return this.client.transaction(async (tx) => {
      const agentPlaceholders = params.agentIds.map(() => "?").join(", ");
      const selected = await tx.query(
        `select id from enterprise_agent_tasks
          where tenant_id = ?
            and status = 'queued'
            and agent_id in (${agentPlaceholders})
          order by created_at asc
          limit 1
          for update skip locked`,
        [params.tenantId, ...params.agentIds],
      );
      const id = selected.rows[0]?.id;
      if (id == null) return null;
      const updated = await tx.query(
        `update enterprise_agent_tasks
            set status = 'claimed',
                claimed_by_user_id = ?,
                claimed_by_device = ?,
                claimed_at = ?,
                lease_expires_at = ?,
                updated_at = ?
          where id = ?
            and tenant_id = ?
            and status = 'queued'`,
        [params.userId, params.deviceId, now, lease, now, String(id), params.tenantId],
      );
      if ((updated.rowCount ?? 0) < 1) return null;
      const loaded = await tx.query(
        `select * from enterprise_agent_tasks
          where id = ? and tenant_id = ?
          limit 1`,
        [String(id), params.tenantId],
      );
      const row = loaded.rows[0];
      return row ? mapAgentTask(row) : null;
    });
  }

  public async completeTask(params: {
    tenantId: string;
    userId: string;
    deviceId: string;
    taskId: string;
    resultMessageId: string;
  }): Promise<AgentTask> {
    const now = new Date();
    const updated = await this.client.query(
      `update enterprise_agent_tasks
          set status = 'completed',
              result_message_id = ${this.ph(1)},
              completed_at = ${this.ph(2)},
              updated_at = ${this.ph(3)}
        where id = ${this.ph(4)}
          and tenant_id = ${this.ph(5)}
          and status = 'claimed'
          and claimed_by_user_id = ${this.ph(6)}
          and claimed_by_device = ${this.ph(7)}`,
      [params.resultMessageId, now, now, params.taskId, params.tenantId, params.userId, params.deviceId],
    );
    if ((updated.rowCount ?? 0) < 1) throw new WorkerTaskConflictError();
    const task = await this.getAgentTask(params.tenantId, params.taskId);
    if (!task) throw new WorkerTaskConflictError();
    return task;
  }

  public async failTask(params: {
    tenantId: string;
    userId: string;
    deviceId: string;
    taskId: string;
    error: string;
  }): Promise<AgentTask> {
    const now = new Date();
    const error = params.error.slice(0, ERROR_MAX);
    const updated = await this.client.query(
      `update enterprise_agent_tasks
          set status = 'failed',
              error = ${this.ph(1)},
              updated_at = ${this.ph(2)}
        where id = ${this.ph(3)}
          and tenant_id = ${this.ph(4)}
          and status = 'claimed'
          and claimed_by_user_id = ${this.ph(5)}
          and claimed_by_device = ${this.ph(6)}`,
      [error, now, params.taskId, params.tenantId, params.userId, params.deviceId],
    );
    if ((updated.rowCount ?? 0) < 1) throw new WorkerTaskConflictError();
    const task = await this.getAgentTask(params.tenantId, params.taskId);
    if (!task) throw new WorkerTaskConflictError();
    return task;
  }
}
