import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canTransitionIncidentStatus,
  getSecurityIncidentRepository,
  mapIncidentActionRow,
  mapIncidentRow,
  type SecurityIncidentStatus,
} from "../incidents";

describe("incident status machine (SP5 三态状态机)", () => {
  it.each([
    ["open", "handling"],
    ["handling", "resolved"],
    ["resolved", "handling"],
  ] as const)("allows legal edge %s -> %s", (from, to) => {
    expect(canTransitionIncidentStatus(from, to)).toBe(true);
  });

  it.each([
    ["open", "resolved"],
    ["open", "open"],
    ["handling", "open"],
    ["handling", "handling"],
    ["resolved", "resolved"],
    ["resolved", "open"],
  ] as const)("rejects illegal edge %s -> %s", (from, to) => {
    expect(canTransitionIncidentStatus(from as SecurityIncidentStatus, to as SecurityIncidentStatus)).toBe(false);
  });
});

describe("incident repository dialect dispatch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("selects per-dialect implementations from DATABASE_URL", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/agenticx");
    const pg = getSecurityIncidentRepository();
    vi.stubEnv("DATABASE_URL", "mysql://localhost/agenticx");
    const mysql = getSecurityIncidentRepository();

    expect(pg.updateIncidentStatus).not.toBe(mysql.updateIncidentStatus);
    expect(pg.insertIncidentAction).not.toBe(mysql.insertIncidentAction);
  });
});

describe("incident row mapping", () => {
  it("maps incident rows with ISO timestamps and null-safe fields", () => {
    const row = {
      id: "inc-1",
      tenantId: "tenant-s",
      title: "PII 外泄",
      source: "policy_hit",
      severity: "critical",
      status: "handling",
      traceId: "trace-9",
      sessionId: null,
      userId: "u-1",
      model: "glm-5.3",
      summary: null,
      createdBy: "u-admin",
      handledAt: new Date("2026-11-13T02:00:00.000Z"),
      resolvedAt: null,
      resolutionNote: null,
      createdAt: new Date("2026-11-13T01:00:00.000Z"),
      updatedAt: new Date("2026-11-13T01:00:00.000Z"),
    } as Parameters<typeof mapIncidentRow>[0];
    const record = mapIncidentRow(row);
    expect(record.status).toBe("handling");
    expect(record.handledAt).toBe("2026-11-13T02:00:00.000Z");
    expect(record.sessionId).toBeNull();
  });

  it("parses action detail from text column and defaults outcome", () => {
    const row = {
      id: "act-1",
      incidentId: "inc-1",
      tenantId: "tenant-s",
      actionType: "revoke_pat",
      targetType: "pat",
      targetId: "42",
      actorUserId: "u-admin",
      detail: JSON.stringify({ pat_id: "42", stage: "intent" }),
      outcome: "done",
      createdAt: new Date("2026-11-13T01:00:00.000Z"),
    } as Parameters<typeof mapIncidentActionRow>[0];
    const record = mapIncidentActionRow(row);
    expect(record.detail).toEqual({ pat_id: "42", stage: "intent" });
    expect(record.outcome).toBe("done");

    const empty = mapIncidentActionRow({ ...row, detail: null, outcome: null } as Parameters<
      typeof mapIncidentActionRow
    >[0]);
    expect(empty.detail).toBeNull();
    expect(empty.outcome).toBe("failed");
  });
});
