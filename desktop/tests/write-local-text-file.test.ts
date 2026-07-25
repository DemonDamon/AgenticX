import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  WRITE_LOCAL_TEXT_MAX_BYTES,
  writeLocalTextFileAtomic,
} from "../electron/write-local-text-file";

function tmpFile(name: string, content: string | Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-write-text-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

describe("writeLocalTextFileAtomic", () => {
  it("rejects STALE mtime and leaves content unchanged", async () => {
    const file = tmpFile("a.txt", "original\n");
    try {
      const st = fs.statSync(file);
      const res = await writeLocalTextFileAtomic(
        {
          path: file,
          content: "overwrite\n",
          expectedMtimeMs: st.mtimeMs - 5000,
        },
        (p) => path.resolve(p),
      );
      expect(res.ok).toBe(false);
      expect(res.code).toBe("STALE");
      expect(fs.readFileSync(file, "utf8")).toBe("original\n");
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("rejects oversized writes", async () => {
    const file = tmpFile("big.txt", "ok\n");
    try {
      const huge = "x".repeat(WRITE_LOCAL_TEXT_MAX_BYTES + 1);
      const res = await writeLocalTextFileAtomic(
        { path: file, content: huge },
        (p) => path.resolve(p),
      );
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/too large/i);
      expect(fs.readFileSync(file, "utf8")).toBe("ok\n");
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it("atomically writes and leaves no .tmp residue; preserves CRLF", async () => {
    const file = tmpFile("crlf.txt", "a\r\nb\r\n");
    try {
      const st = fs.statSync(file);
      const res = await writeLocalTextFileAtomic(
        {
          path: file,
          content: "a\nb\nc\n",
          eol: "crlf",
          expectedMtimeMs: st.mtimeMs,
        },
        (p) => path.resolve(p),
      );
      expect(res.ok).toBe(true);
      expect(typeof res.mtimeMs).toBe("number");
      const raw = fs.readFileSync(file);
      expect(raw.includes(Buffer.from("\r\n"))).toBe(true);
      expect(raw.toString("utf8")).toBe("a\r\nb\r\nc\r\n");
      const leftovers = fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith(".tmp"));
      expect(leftovers).toEqual([]);
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });
});
