import { resolveDatabaseConfig } from "@agenticx/iam-core";
import * as mysql from "./db-stores/mysql/agent-trace-store";
import * as postgresql from "./db-stores/postgresql/agent-trace-store";

export type * from "./db-stores/postgresql/agent-trace-store";

function implementation(): typeof postgresql {
  const config = resolveDatabaseConfig();
  return config.dialect === "mysql" ? mysql : postgresql;
}

export const listAgentTraceIds: typeof postgresql.listAgentTraceIds = (...args: Parameters<typeof postgresql.listAgentTraceIds>) =>
  implementation().listAgentTraceIds(...args);

export const getAgentTrace: typeof postgresql.getAgentTrace = (...args: Parameters<typeof postgresql.getAgentTrace>) =>
  implementation().getAgentTrace(...args);

export const ingestAgentTraceSpans: typeof postgresql.ingestAgentTraceSpans = (...args: Parameters<typeof postgresql.ingestAgentTraceSpans>) =>
  implementation().ingestAgentTraceSpans(...args);
