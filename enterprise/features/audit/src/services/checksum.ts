import { createHash } from "node:crypto";

export type PersistedChecksum = {
  checksumVersion: string | null | undefined;
  checksumPayload: string | null | undefined;
  prevChecksum: string;
  checksum: string;
};

export type PersistedChecksumResult =
  | { status: "verified" }
  | { status: "legacy" }
  | { status: "invalid"; reason: "checksum_payload_missing" | "checksum_mismatch" };

export function computeChecksumFromPayload(prevChecksum: string, checksumPayload: string): string {
  const hash = createHash("blake2b512");
  hash.update(`${prevChecksum}|${checksumPayload}`);
  return hash.digest("hex").slice(0, 64);
}

export function verifyPersistedChecksum(input: PersistedChecksum): PersistedChecksumResult {
  const version = input.checksumVersion?.trim() || "v1";
  if (version !== "v2") {
    return { status: "legacy" };
  }
  if (!input.checksumPayload) {
    return { status: "invalid", reason: "checksum_payload_missing" };
  }
  if (computeChecksumFromPayload(input.prevChecksum, input.checksumPayload) !== input.checksum) {
    return { status: "invalid", reason: "checksum_mismatch" };
  }
  return { status: "verified" };
}
