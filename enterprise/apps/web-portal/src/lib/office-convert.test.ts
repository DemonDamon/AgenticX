import { describe, expect, it, vi } from "vitest";
import {
  convertLegacyOffice,
  OFFICE_CONVERT_MISSING_MSG,
  resolveLibreOfficeBin,
} from "./office-convert";

describe("resolveLibreOfficeBin", () => {
  it("returns null when no bin is available", async () => {
    const execFile = vi.fn().mockRejectedValue(new Error("not found"));
    const access = vi.fn().mockRejectedValue(new Error("missing"));
    const prev = process.env.LIBREOFFICE_BIN;
    delete process.env.LIBREOFFICE_BIN;
    try {
      await expect(resolveLibreOfficeBin({ execFile, access })).resolves.toBeNull();
    } finally {
      if (prev !== undefined) process.env.LIBREOFFICE_BIN = prev;
    }
  });

  it("prefers LIBREOFFICE_BIN when executable", async () => {
    const execFile = vi.fn();
    const access = vi.fn().mockResolvedValue(undefined);
    const prev = process.env.LIBREOFFICE_BIN;
    process.env.LIBREOFFICE_BIN = "/custom/soffice";
    try {
      await expect(resolveLibreOfficeBin({ execFile, access })).resolves.toBe("/custom/soffice");
      expect(execFile).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.LIBREOFFICE_BIN;
      else process.env.LIBREOFFICE_BIN = prev;
    }
  });
});

describe("convertLegacyOffice", () => {
  it("throws readable error when LibreOffice is missing", async () => {
    await expect(
      convertLegacyOffice(
        { buffer: Buffer.from("fake"), fromExt: "doc", toExt: "docx" },
        { resolveBin: async () => null },
      ),
    ).rejects.toThrow(/LibreOffice/);
    await expect(
      convertLegacyOffice(
        { buffer: Buffer.from("fake"), fromExt: "doc", toExt: "docx" },
        { resolveBin: async () => null },
      ),
    ).rejects.toThrow(OFFICE_CONVERT_MISSING_MSG);
  });

  it("runs soffice and returns converted buffer", async () => {
    const outBuf = Buffer.from("PK-docx-fake");
    const written: Array<{ path: string; data: Buffer }> = [];
    const execFile = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const mkdtemp = vi.fn().mockResolvedValue("/tmp/agx-office-test");
    const writeFile = vi.fn().mockImplementation(async (path: string, data: Buffer) => {
      written.push({ path, data });
    });
    const readFile = vi.fn().mockResolvedValue(outBuf);
    const rm = vi.fn().mockResolvedValue(undefined);

    const result = await convertLegacyOffice(
      { buffer: Buffer.from("ole-doc"), fromExt: "doc", toExt: "docx" },
      {
        resolveBin: async () => "/usr/bin/soffice",
        execFile,
        mkdtemp,
        writeFile,
        readFile,
        rm,
        tmpdir: () => "/tmp",
      },
    );

    expect(result.equals(outBuf)).toBe(true);
    expect(execFile).toHaveBeenCalledWith(
      "/usr/bin/soffice",
      expect.arrayContaining(["--headless", "--convert-to", "docx"]),
      expect.objectContaining({ timeout: 60_000 }),
    );
    expect(rm).toHaveBeenCalled();
    expect(written[0]?.data.equals(Buffer.from("ole-doc"))).toBe(true);
  });
});
