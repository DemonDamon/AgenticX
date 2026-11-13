import { describe, expect, it } from "vitest";

import { classifyReplica, policyPublishVersion, REPLICA_OFFLINE_AFTER_MS } from "./gateway-replica-status";

const now = new Date("2026-11-09T08:00:00.000Z");

function domains(policyVersion: string, channelError = "") {
  return [
    { domain: "providers", version: "", lastError: "" },
    { domain: "channels", version: "", lastError: channelError },
    { domain: "policy", version: policyVersion, lastError: "" },
    { domain: "mcp_servers", version: "", lastError: "" },
  ];
}

describe("gateway replica status", () => {
  it("joins publish ids after sorting tenant ids", () => {
    expect(
      policyPublishVersion([
        { tenantId: "t-b", publishId: "pub-b" },
        { tenantId: "t-a", publishId: "pub-a" },
      ]),
    ).toBe("pub-a,pub-b");
    expect(policyPublishVersion([])).toBe("");
  });

  it("returns applied when the heartbeat is fresh and the policy version matches", () => {
    expect(
      classifyReplica({
        lastSeenAt: new Date(now.getTime() - (REPLICA_OFFLINE_AFTER_MS - 1)),
        now,
        domains: domains(""),
        publishedPolicyVersion: "",
      }),
    ).toBe("applied");
  });

  it("returns offline at two minutes and for an invalid timestamp", () => {
    expect(
      classifyReplica({
        lastSeenAt: new Date(now.getTime() - REPLICA_OFFLINE_AFTER_MS),
        now,
        domains: domains(""),
        publishedPolicyVersion: "",
      }),
    ).toBe("offline");
    expect(
      classifyReplica({
        lastSeenAt: new Date("not-a-date"),
        now,
        domains: domains("pub-a"),
        publishedPolicyVersion: "pub-a",
      }),
    ).toBe("offline");
  });

  it("returns pending when the policy version differs or any domain has an error", () => {
    expect(
      classifyReplica({
        lastSeenAt: new Date(now.getTime() - 10_000),
        now,
        domains: domains("pub-old"),
        publishedPolicyVersion: "pub-a,pub-b",
      }),
    ).toBe("pending");
    expect(
      classifyReplica({
        lastSeenAt: new Date(now.getTime() - 10_000),
        now,
        domains: domains("pub-a,pub-b", "reload failed"),
        publishedPolicyVersion: "pub-a,pub-b",
      }),
    ).toBe("pending");
  });

  it("prefers offline when the replica is also not applied", () => {
    expect(
      classifyReplica({
        lastSeenAt: new Date(now.getTime() - REPLICA_OFFLINE_AFTER_MS - 1),
        now,
        domains: domains("pub-old", "reload failed"),
        publishedPolicyVersion: "pub-a",
      }),
    ).toBe("offline");
  });
});
