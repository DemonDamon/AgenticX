import { describe, expect, it } from "vitest";
import { computeChecksumFromPayload, verifyPersistedChecksum } from "./checksum";

const payload =
  '{"id":"audit-fixture","tenant_id":"tenant-fixture","event_time":"2026-07-16T10:00:00Z","event_type":"chat_call","client_type":"web-portal","route":"third-party","input_tokens":5,"output_tokens":7,"total_tokens":12,"checksum_version":"v2","prev_checksum":"GENESIS","checksum":""}';
const expected = "ce374a326a6aa72fcedc52bc5818851a4ecc494967b751830bd2d91da5c15e9c";

describe("persisted audit checksum", () => {
  it("matches the Go Blake2b fixture", () => {
    expect(computeChecksumFromPayload("GENESIS", payload)).toBe(expected);
  });

  it("distinguishes legacy rows from tampered v2 rows", () => {
    expect(
      verifyPersistedChecksum({
        checksumVersion: "v1",
        checksumPayload: null,
        prevChecksum: "GENESIS",
        checksum: "legacy",
      }),
    ).toEqual({ status: "legacy" });
    expect(
      verifyPersistedChecksum({
        checksumVersion: "v2",
        checksumPayload: payload,
        prevChecksum: "GENESIS",
        checksum: "tampered",
      }),
    ).toEqual({ status: "invalid", reason: "checksum_mismatch" });
  });
});
