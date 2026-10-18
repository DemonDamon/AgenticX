/**
 * Read a STORE-method ZIP (no compression). Used to preview case-library pages.
 *
 * Author: Damon Li
 */

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
