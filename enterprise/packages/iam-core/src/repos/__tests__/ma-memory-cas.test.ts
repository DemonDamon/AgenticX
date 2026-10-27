import { describe, expect, it } from "vitest";

import {
  assertCanDeleteMemoryStore,
  dreamOutputMetadata,
  MaMemoryStoreInUseError,
  MaMemoryStoreNotArchivedError,
  MaMemoryVersionIsHeadError,
  memoryStoreValidationStatus,
  planDreamReviewDecision,
  planMemoryVersionRedact,
} from "../ma-memory";
import { MaMemoryValidationError } from "../ma-memory-path";
import {
  contentSha256,
  MEMORY_STORE_MAX_BYTES,
  MEMORY_STORE_MAX_ITEMS,
  planMemoryWrite,
  type MemoryHead,
  type MemoryPathRow,
} from "../ma-memory-path";

function head(overrides: Partial<MemoryHead> = {}): MemoryHead {
  const content = overrides.content ?? "hello";
  return {
    id: "m1",
    path: "/a.md",
    version: 1,
    content,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    contentSha256: contentSha256(content),
    ...overrides,
  };
}

function row(memory: MemoryHead): MemoryPathRow {
  return {
    id: memory.id,
    path: memory.path,
    version: memory.version,
    contentSha256: memory.contentSha256,
    sizeBytes: memory.sizeBytes,
  };
}

describe("planMemoryWrite", () => {
  it("assigns version 1 on create and version + 1 on update and delete", () => {
    const created = planMemoryWrite(null, { op: "create", path: "/a.md", content: "hello" }, [], { count: 0, totalBytes: 0 });
    expect(created.kind).toBe("insert");
    if (created.kind !== "insert") return;
    expect(created.version).toBe(1);
    expect(created.operation).toBe("created");

    const current = head();
    const updated = planMemoryWrite(
      current,
      { op: "update", memoryId: current.id, expectedVersion: 1, content: "next" },
      [row(current)],
      { count: 1, totalBytes: current.sizeBytes },
    );
    expect(updated.kind).toBe("update");
    if (updated.kind !== "update") return;
    expect(updated.version).toBe(2);
    expect(updated.operation).toBe("modified");

    const same = planMemoryWrite(
      current,
      { op: "update", memoryId: current.id, expectedVersion: 1, content: current.content },
      [row(current)],
      { count: 1, totalBytes: current.sizeBytes },
    );
    expect(same.kind).toBe("noop");

    const deleted = planMemoryWrite(
      current,
      { op: "delete", memoryId: current.id, expectedVersion: 1 },
      [row(current)],
      { count: 1, totalBytes: current.sizeBytes },
    );
    expect(deleted.kind).toBe("delete");
    if (deleted.kind !== "delete") return;
    expect(deleted.version).toBe(2);
    expect(deleted.operation).toBe("deleted");
  });

  it("enforces item and byte limits, subtracting the old size on update", () => {
    const limited = planMemoryWrite(
      null,
      { op: "create", path: "/new.md", content: "x" },
      [],
      { count: MEMORY_STORE_MAX_ITEMS, totalBytes: 0 },
    );
    expect(limited.kind).toBe("error");
    if (limited.kind === "error") expect(limited.code).toBe("memory_store_limit");

    const almost = MEMORY_STORE_MAX_BYTES - 10;
    const tooBig = planMemoryWrite(
      null,
      { op: "create", path: "/new.md", content: "12345678901" },
      [],
      { count: 1, totalBytes: almost },
    );
    expect(tooBig.kind).toBe("error");
    if (tooBig.kind === "error") expect(tooBig.code).toBe("memory_store_limit");

    const current = head({ content: "a".repeat(100) });
    const shrunk = planMemoryWrite(
      current,
      { op: "update", memoryId: current.id, expectedVersion: 1, content: "b".repeat(50) },
      [row(current)],
      { count: 1, totalBytes: MEMORY_STORE_MAX_BYTES },
    );
    expect(shrunk.kind).toBe("update");

    const small = head({ content: "a".repeat(10) });
    const grown = planMemoryWrite(
      small,
      { op: "update", memoryId: small.id, expectedVersion: 1, content: "b".repeat(21) },
      [row(small)],
      { count: 1, totalBytes: MEMORY_STORE_MAX_BYTES },
    );
    expect(grown.kind).toBe("error");
    if (grown.kind === "error") expect(grown.code).toBe("memory_store_limit");
  });

  it("reports version and path conflicts", () => {
    const current = head({ version: 4 });
    const stale = planMemoryWrite(
      current,
      { op: "update", memoryId: current.id, expectedVersion: 3, content: "z" },
      [row(current)],
      { count: 1, totalBytes: current.sizeBytes },
    );
    expect(stale.kind).toBe("error");
    if (stale.kind === "error") {
      expect(stale.code).toBe("memory_version_conflict");
      expect(stale.current?.version).toBe(4);
    }

    const existing = head({ id: "m-existing", path: "/a.md" });
    const duplicate = planMemoryWrite(
      null,
      { op: "create", path: "/a.md", content: "other" },
      [row(existing)],
      { count: 1, totalBytes: existing.sizeBytes },
    );
    expect(duplicate.kind).toBe("error");
    if (duplicate.kind === "error") {
      expect(duplicate.code).toBe("memory_path_conflict");
      expect(duplicate.current?.path).toBe("/a.md");
    }
  });
});

describe("redact", () => {
  it("refuses the head version, including a deleted memory's latest version", () => {
    expect(() =>
      planMemoryVersionRedact(
        { operation: "modified", version: 2, path: "/a.md", content: "b", redacted: false },
        { memoryVersion: 2, maxVersion: 2 },
      ),
    ).toThrow(MaMemoryVersionIsHeadError);
    expect(() =>
      planMemoryVersionRedact(
        { operation: "deleted", version: 3, path: "/a.md", content: null, redacted: false },
        { memoryVersion: null, maxVersion: 3 },
      ),
    ).toThrow(MaMemoryVersionIsHeadError);
    expect(
      planMemoryVersionRedact(
        { operation: "created", version: 1, path: "/a.md", content: "a", redacted: false },
        { memoryVersion: 2, maxVersion: 2 },
      ),
    ).toEqual({ redacted: true, path: null, content: null });
  });
});

describe("delete preconditions", () => {
  it("requires the store to be archived and unused", () => {
    expect(() => assertCanDeleteMemoryStore("active", 0)).toThrow(MaMemoryStoreNotArchivedError);
    expect(() => assertCanDeleteMemoryStore("archived", 1)).toThrow(MaMemoryStoreInUseError);
    expect(() => assertCanDeleteMemoryStore("archived", 0)).not.toThrow();
  });
});

describe("dream review gate", () => {
  it("validateMemoryStoreIds reports pending_review until the store is approved", () => {
    expect(memoryStoreValidationStatus("active", { "agx.review": "pending" })).toBe("pending_review");
    expect(memoryStoreValidationStatus("active", { "agx.review": "running" })).toBe("pending_review");
    expect(memoryStoreValidationStatus("active", { "agx.review": "failed" })).toBe("pending_review");
    expect(memoryStoreValidationStatus("active", { "agx.review": "cancelled" })).toBe("pending_review");
    expect(memoryStoreValidationStatus("active", { "agx.review": "approved" })).toBe("active");
    expect(memoryStoreValidationStatus("archived", { "agx.review": "discarded" })).toBe("archived");
    expect(memoryStoreValidationStatus("active", {})).toBe("active");
  });

  it("setDreamReviewDecision rejects stores that are not awaiting review", () => {
    expect(() => planDreamReviewDecision({ "agx.origin": "manual", "agx.review": "pending" }, "approve")).toThrow(
      MaMemoryValidationError,
    );
    expect(() => planDreamReviewDecision({ "agx.origin": "dream", "agx.review": "running" }, "approve")).toThrow(
      /memory store is not awaiting review/,
    );
    const approved = planDreamReviewDecision({ "agx.origin": "dream", "agx.review": "pending" }, "approve");
    expect(approved).toEqual({ review: "approved", archive: false });
    const discarded = planDreamReviewDecision({ "agx.origin": "dream", "agx.review": "pending" }, "discard");
    expect(discarded).toEqual({ review: "discarded", archive: true });
  });

  it("stamps a new dream output store with the four origin keys", () => {
    expect(dreamOutputMetadata("01DREAM0000000000000000001", "01INPUT0000000000000000001")).toEqual({
      "agx.origin": "dream",
      "agx.dream_id": "01DREAM0000000000000000001",
      "agx.review": "running",
      "agx.dream_input": "01INPUT0000000000000000001",
    });
  });
});
