export function floatFrameToTargetPcm16(
  src: Float32Array,
  srcRate: number,
  targetRate: number
): Uint8Array {
  if (!src.byteLength || targetRate <= 0 || srcRate <= 0) return new Uint8Array();
  const outSamples = Math.max(1, Math.floor((src.length * targetRate) / srcRate));
  const out = new DataView(new ArrayBuffer(outSamples * 2));
  let o = 0;
  while (o < outSamples) {
    const t = (o * srcRate) / targetRate;
    const i = Math.min(src.length - 1, Math.floor(t));
    const s = Math.max(-1, Math.min(1, src[i]!));
    out.setInt16(o * 2, Math.round(s * 32767), true);
    o += 1;
  }
  return new Uint8Array(out.buffer);
}

export function httpBaseToWs(apiBase: string): string {
  const u = apiBase.replace(/\/+$/, "");
  if (u.startsWith("https://")) return `wss://${u.slice("https://".length)}`;
  if (u.startsWith("http://")) return `ws://${u.slice("http://".length)}`;
  return u;
}
