import { describe, expect, it } from "vitest";

import { parseEnterpriseWorkerStatus, workerStateLabelKey } from "./enterprise-worker-status";

const SAMPLE = {
  enabled: true,
  running: true,
  protocol: "dual",
  ma_enabled: true,
  ma_environment_mode: "auto",
  ma_environments: [{ id: "01JENV", name: "研发桌面" }],
  ma_work: [
    {
      work_id: "01JWORK",
      session_id: "01JSESS",
      agent_id: "01JAGENT",
      agent_version: 3,
      environment_id: "01JENV",
      started_at: "2026-10-26T08:00:00Z",
      workdir: "~/.agenticx/sessions/01JSESS/work",
      interactive: false,
    },
  ],
  interactive_environments: ["01JENV"],
  last_heartbeat_at: "2026-10-26T08:00:05Z",
  last_error: "",
  agents: [{ id: "legacy-1", displayName: "旧助手", slug: "legacy" }],
};

describe("enterprise worker status", () => {
  it("parses full payload", () => {
    const parsed = parseEnterpriseWorkerStatus(SAMPLE);
    expect(parsed.enabled).toBe(true);
    expect(parsed.running).toBe(true);
    expect(parsed.maEnabled).toBe(true);
    expect(parsed.environments).toEqual([{ id: "01JENV", name: "研发桌面" }]);
    expect(parsed.work).toEqual([
      {
        workId: "01JWORK",
        sessionId: "01JSESS",
        agentId: "01JAGENT",
        agentVersion: 3,
        environmentId: "01JENV",
        startedAt: "2026-10-26T08:00:00Z",
        workdir: "~/.agenticx/sessions/01JSESS/work",
        interactive: false,
      },
    ]);
    expect(parsed.work[0]?.agentVersion).toBe(3);
    expect(parsed.lastHeartbeatAt).toBe("2026-10-26T08:00:05Z");
    expect(parsed.legacyAgents).toEqual(["旧助手"]);
  });

  it("tolerates missing ma keys", () => {
    const parsed = parseEnterpriseWorkerStatus({
      enabled: false,
      running: false,
      device_id: "near-1",
      agents: [],
      last_heartbeat_at: null,
      current_task_id: null,
      last_error: null,
    });
    expect(parsed.maEnabled).toBe(false);
    expect(parsed.environments).toEqual([]);
    expect(parsed.work).toEqual([]);
  });

  it("labels running, paused, and stopped", () => {
    expect(workerStateLabelKey({ enabled: false, running: true })).toBe("paused");
    expect(workerStateLabelKey({ enabled: true, running: true })).toBe("running");
    expect(workerStateLabelKey({ enabled: true, running: false })).toBe("stopped");
  });
});
