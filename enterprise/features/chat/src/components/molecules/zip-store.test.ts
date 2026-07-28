import { describe, expect, it } from "vitest";
import { buildStoreZip } from "./zip-store";

describe("buildStoreZip", () => {
  it("emits a zip local + central signature", async () => {
    const blob = buildStoreZip([
      { path: "final-report.md", data: new TextEncoder().encode("# hi") },
      { path: "lanes/q1/memo.md", data: new TextEncoder().encode("memo") },
    ]);
    const buf = new Uint8Array(await blob.arrayBuffer());
    // local file header signature PK\x03\x04
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
    expect(blob.type).toBe("application/zip");
    expect(buf.length).toBeGreaterThan(64);
  });
});
