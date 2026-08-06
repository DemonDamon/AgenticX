import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  __resolveSafeBlobPathForTests,
  createMemoryOriginalStore,
} from "../original-store";

describe("original-store memory driver", () => {
  it("put → getMeta → openStream round-trips bytes and checksum", async () => {
    const store = createMemoryOriginalStore();
    const buffer = Buffer.from("hello-original-pdf");
    const record = await store.put({
      tenantId: "01TENANTAAAAAAAAAAAAAAAAAA",
      userId: "01USERAAAAAAAAAAAAAAAAAAAA",
      fileName: "a.pdf",
      mimeType: "application/pdf",
      kind: "document",
      buffer,
    });
    expect(record.checksum).toBe(createHash("sha256").update(buffer).digest("hex"));
    const meta = await store.getMeta(record.tenantId, record.userId, record.id);
    expect(meta?.fileName).toBe("a.pdf");
    const stream = await store.openStream(record);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).toString("utf8")).toBe("hello-original-pdf");
  });

  it("rejects path-escape storage keys on open", () => {
    expect(() => __resolveSafeBlobPathForTests("../../etc/passwd")).toThrow(/path escape/);
  });

  it("isolates tenants on getMeta", async () => {
    const store = createMemoryOriginalStore();
    const record = await store.put({
      tenantId: "01TENANTAAAAAAAAAAAAAAAAAA",
      userId: "01USERAAAAAAAAAAAAAAAAAAAA",
      fileName: "a.pdf",
      mimeType: "application/pdf",
      kind: "document",
      buffer: Buffer.from("x"),
    });
    const other = await store.getMeta("01TENANTBBBBBBBBBBBBBBBBBBBB", record.userId, record.id);
    expect(other).toBeNull();
  });
});
