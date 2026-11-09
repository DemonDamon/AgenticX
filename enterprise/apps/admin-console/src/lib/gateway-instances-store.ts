import { resolveDatabaseConfig } from "@agenticx/iam-core";

import * as mysql from "./db-stores/mysql/gateway-instances-store";
import * as postgresql from "./db-stores/postgresql/gateway-instances-store";
import {
  writeHeartbeat,
  type GatewayInstanceRepository,
  type GatewayInstanceRow,
  type HeartbeatWrite,
} from "./gateway-instances-model";

export {
  HEARTBEAT_RETENTION_MS,
  parseHeartbeatBody,
  type GatewayInstanceRepository,
  type GatewayInstanceRow,
  type HeartbeatDomain,
  type HeartbeatStatus,
  type HeartbeatWrite,
} from "./gateway-instances-model";

let testRepository: GatewayInstanceRepository | null = null;

export function __setGatewayInstanceRepositoryForTests(repo: GatewayInstanceRepository | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("gateway instance repository override is test-only");
  }
  testRepository = repo;
}

function repository(): GatewayInstanceRepository {
  if (testRepository) return testRepository;
  const config = resolveDatabaseConfig();
  return config.dialect === "mysql" ? mysql.createGatewayInstanceRepository() : postgresql.createGatewayInstanceRepository();
}

export async function recordGatewayHeartbeat(input: HeartbeatWrite, now = new Date()): Promise<void> {
  await writeHeartbeat(repository(), input, now);
}

export async function listGatewayInstances(): Promise<GatewayInstanceRow[]> {
  return repository().list();
}
