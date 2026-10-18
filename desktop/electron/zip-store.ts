/**
 * Minimal STORE (no compression) ZIP writer — zero-dependency, cross-platform.
 *
 * Used by the design-canvas「Design ZIP」export. Entries are written flat with
 * UTF-8 file names (general-purpose bit 11 set), so Finder / Windows Explorer
 * / `unzip` all open the result. Total size must stay under the ZIP64
 * threshold (4 GiB), comfortably above any canvas export.
 *
 * Author: Damon Li
 */
import fs from "node:fs";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export type StoreZipEntry = { name: string; data: Buffer; mtime?: Date };

export async function writeStoreZip(targetPath: string, entries: StoreZipEntry[]): Promise<void> {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const { time, date } = dosDateTime(entry.mtime ?? new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(0, 8); // method: STORE
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18); // compressed size
    local.writeUInt32LE(entry.data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    chunks.push(local, nameBytes, entry.data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // central directory signature
    cd.writeUInt16LE((3 << 8) | 20, 4); // version made by (unix, 2.0)
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(entry.data.length, 20);
    cd.writeUInt32LE(entry.data.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    // 30: extra len, 32: comment len, 34: disk start, 36: internal attrs — all 0
    cd.writeUInt32LE(0x81a40000, 38); // external attrs: unix mode 100644
    cd.writeUInt32LE(offset, 42); // local header offset
    central.push(cd, nameBytes);

    offset += 30 + nameBytes.length + entry.data.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  await fs.promises.writeFile(targetPath, Buffer.concat([...chunks, cdBuf, eocd]));
}

/** Read a STORE-method ZIP written by `writeStoreZip`. Compressed entries are rejected. */
export function readStoreZip(buf: Buffer): { name: string; data: Buffer }[] {
  const entries: { name: string; data: Buffer }[] = [];
  let offset = 0;
  while (offset + 30 <= buf.length) {
    const signature = buf.readUInt32LE(offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) throw new Error("not a zip package");
    const method = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const nameLength = buf.readUInt16LE(offset + 26);
    const extraLength = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    if (dataStart + compressedSize > buf.length) throw new Error("truncated zip");
    const name = buf.subarray(nameStart, nameStart + nameLength).toString("utf8");
    if (method !== 0) throw new Error(`compressed entry is not supported: ${name}`);
    if (name.split("/").includes("..") || name.startsWith("/")) throw new Error("unsafe zip path");
    entries.push({ name, data: Buffer.from(buf.subarray(dataStart, dataStart + compressedSize)) });
    offset = dataStart + compressedSize;
  }
  return entries.filter((entry) => entry.name && !entry.name.endsWith("/"));
}
