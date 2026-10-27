export type EnterpriseWorkerStatus = {
  enabled: boolean;
  running: boolean;
  maEnabled: boolean;
  environments: Array<{ id: string; name: string }>;
  work: Array<{
    workId: string;
    sessionId: string;
    agentId: string;
    agentVersion: number;
    environmentId: string;
    startedAt: string;
    workdir: string;
    interactive: boolean;
  }>;
  lastHeartbeatAt: string;
  lastError: string;
  legacyAgents: string[];
};

const EMPTY: EnterpriseWorkerStatus = {
  enabled: false,
  running: false,
  maEnabled: false,
  environments: [],
  work: [],
  lastHeartbeatAt: "",
  lastError: "",
  legacyAgents: [],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

/** Defensive parse of GET /api/enterprise-worker/status. Missing fields fall back to empty values. */
export function parseEnterpriseWorkerStatus(raw: unknown): EnterpriseWorkerStatus {
  const data = asRecord(raw);
  if (!data) return { ...EMPTY, environments: [], work: [], legacyAgents: [] };
  const environments = Array.isArray(data.ma_environments)
    ? data.ma_environments.flatMap((item) => {
        const row = asRecord(item);
        if (!row) return [];
        const id = text(row.id).trim();
        if (!id) return [];
        const name = text(row.name).trim() || id;
        return [{ id, name }];
      })
    : [];
  const work = Array.isArray(data.ma_work)
    ? data.ma_work.flatMap((item) => {
        const row = asRecord(item);
        if (!row) return [];
        const workId = text(row.work_id);
        if (!workId) return [];
        return [
          {
            workId,
            sessionId: text(row.session_id),
            agentId: text(row.agent_id),
            agentVersion: numberValue(row.agent_version),
            environmentId: text(row.environment_id),
            startedAt: text(row.started_at),
            workdir: text(row.workdir),
            interactive: row.interactive === true,
          },
        ];
      })
    : [];
  const legacyAgents = Array.isArray(data.agents)
    ? data.agents.flatMap((item) => {
        const row = asRecord(item);
        if (!row) return [];
        const name = text(row.displayName) || text(row.slug) || text(row.id);
        return name ? [name] : [];
      })
    : [];
  return {
    enabled: data.enabled === true,
    running: data.running === true,
    maEnabled: data.ma_enabled === true,
    environments,
    work,
    lastHeartbeatAt: text(data.last_heartbeat_at),
    lastError: text(data.last_error),
    legacyAgents,
  };
}

/** "运行中" | "已暂停" | "未运行" decided from enabled/running. */
export function workerStateLabelKey(
  status: Pick<EnterpriseWorkerStatus, "enabled" | "running">,
): "running" | "paused" | "stopped" {
  if (!status.enabled) return "paused";
  if (status.running) return "running";
  return "stopped";
}
