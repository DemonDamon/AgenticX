const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford Base32, 无 I L O U

function encodeCrockford(value: number): string {
  return ENCODING[value & 31] ?? "0";
}

export function newTraceId(now: number = Date.now()): string {
  // 前 10 位：时间戳（48bit），后 16 位：随机（80bit）
  let ts = "";
  let t = now;
  for (let i = 9; i >= 0; i--) {
    ts = encodeCrockford(t % 32) + ts;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let rand = "";
  for (let i = 0; i < 16; i++) rand += encodeCrockford(bytes[i] ?? 0);
  return ts + rand;
}

/** 宽松校验：26 位 Crockford Base32。用于服务端拒绝伪造/超长输入。 */
export function isTraceId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}
