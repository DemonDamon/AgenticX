import { resolveDatabaseConfig } from "@agenticx/iam-core";
import { mysqlWorkerTaskStore } from "./mysql";
import { postgresqlWorkerTaskStore } from "./postgresql";
import { SqlWorkerTaskStore } from "./sql-store";
import type { AgentTask, EnqueueAgentTaskInput } from "./types";

export { WorkerTaskConflictError } from "./types";
export type { AgentTask, AgentTaskStatus, EnqueueAgentTaskInput, TaskInput, TaskMessage } from "./types";

function store(): SqlWorkerTaskStore {
  const config = resolveDatabaseConfig();
  switch (config.dialect) {
    case "postgresql":
      return postgresqlWorkerTaskStore;
    case "mysql":
      return mysqlWorkerTaskStore;
    default: {
      const exhaustive: never = config;
      throw new Error(`Unsupported database config: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function enqueueAgentTask(input: EnqueueAgentTaskInput): Promise<AgentTask> {
  return store().enqueueAgentTask(input);
}

export function hasOnlineWorker(tenantId: string, agentId: string, withinSeconds = 120): Promise<boolean> {
  return store().hasOnlineWorker(tenantId, agentId, withinSeconds);
}

export function recordHeartbeat(params: {
  tenantId: string;
  userId: string;
  deviceId: string;
  deviceName: string;
  agentIds: string[];
}): Promise<void> {
  return store().recordHeartbeat(params);
}

export function getAgentTask(tenantId: string, taskId: string): Promise<AgentTask | null> {
  return store().getAgentTask(tenantId, taskId);
}

export function claimNextTask(params: {
  tenantId: string;
  userId: string;
  deviceId: string;
  agentIds: string[];
}): Promise<AgentTask | null> {
  return store().claimNextTask(params);
}

export function completeTask(params: {
  tenantId: string;
  userId: string;
  deviceId: string;
  taskId: string;
  resultMessageId: string;
}): Promise<AgentTask> {
  return store().completeTask(params);
}

export function failTask(params: {
  tenantId: string;
  userId: string;
  deviceId: string;
  taskId: string;
  error: string;
}): Promise<AgentTask> {
  return store().failTask(params);
}

export function sweepExpired(tenantId: string): Promise<AgentTask[]> {
  return store().sweepExpired(tenantId);
}
