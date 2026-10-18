import { describe, expect, it } from "vitest";
import { readStoreZip } from "../store-zip";

function storeZip(name: string, data: Buffer): Buffer {
  const nameBytes = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(30 + nameBytes.length, 42);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + nameBytes.length, 12);
  eocd.writeUInt32LE(30 + nameBytes.length + data.length, 16);
  return Buffer.concat([local, nameBytes, data, central, nameBytes, eocd]);
}

describe("readStoreZip", () => {
  it("reads an uncompressed page", () => {
    const html = Buffer.from("<h1>项目总览</h1>", "utf8");
    const entries = readStoreZip(storeZip("pages/dashboard.html", html));
    expect(entries).toEqual([{ name: "pages/dashboard.html", data: html }]);
  });

  it("rejects a path that escapes the package", () => {
    expect(() => readStoreZip(storeZip("../secret.html", Buffer.from("x")))).toThrow(/unsafe zip path/);
  });
});
