/** Doubao Realtime Dialogue v3 binary framing.
 *
 * Reference: docs/thrdparty/端到端实时语音大模型API接入文档.md (火山 V3).
 *
 * Header (4 bytes, big-endian):
 *   byte0: protocol_version(4)=0b0001 | header_size(4)=0b0001
 *   byte1: message_type(4)              | type_specific_flags(4)=0b0100 (carry event id)
 *   byte2: serialization(4)             | compression(4)=0b0000
 *   byte3: 0x00 reserved
 *
 * Optional fields (按表格顺序，仅在 flags 命中或事件需要时拼接):
 *   event(4)                                 -- always when flags=0b0100
 *   connect_id_size(4) + connect_id          -- only Connect-class client events
 *   session_id_size(4) + session_id          -- only Session-class events (100/102/200/...)
 *
 * Payload:
 *   payload_size(4) + payload(bytes)
 */

export const DOUBAO_MSG_TYPE = {
  FULL_CLIENT_REQUEST: 0b0001,
  FULL_SERVER_RESPONSE: 0b1001,
  AUDIO_ONLY_CLIENT: 0b0010,
  AUDIO_ONLY_SERVER: 0b1011,
  ERROR_INFO: 0b1111,
} as const;

export const DOUBAO_FLAG_EVENT = 0b0100;

export const DOUBAO_EVENT = {
  StartConnection: 1,
  FinishConnection: 2,
  StartSession: 100,
  FinishSession: 102,
  TaskRequest: 200,
  ClientInterrupt: 515,
} as const;

export const DOUBAO_SERVER_EVENT = {
  ConnectionStarted: 50,
  ConnectionFailed: 51,
  ConnectionFinished: 52,
  SessionStarted: 150,
  SessionFinished: 152,
  SessionFailed: 153,
  TTSSentenceStart: 350,
  TTSSentenceEnd: 351,
  TTSResponse: 352,
  TTSEnded: 359,
  ASRInfo: 450,
  ASRResponse: 451,
  ASREnded: 459,
  ChatResponse: 550,
  ChatEnded: 559,
  DialogCommonError: 599,
} as const;

const SER_RAW = 0b0000;
const SER_JSON = 0b0001;

function writeU32BE(buf: Uint8Array, offset: number, value: number) {
  new DataView(buf.buffer, buf.byteOffset + offset, 4).setUint32(0, value >>> 0, false);
}

function readU32BE(buf: Uint8Array, offset: number): number {
  return new DataView(buf.buffer, buf.byteOffset + offset, 4).getUint32(0, false);
}

function header(messageType: number, ser: number): Uint8Array {
  const h = new Uint8Array(4);
  h[0] = (0b0001 << 4) | 0b0001;
  h[1] = ((messageType & 0x0f) << 4) | (DOUBAO_FLAG_EVENT & 0x0f);
  h[2] = ((ser & 0x0f) << 4) | 0;
  h[3] = 0;
  return h;
}

function buildClientFrame(opts: {
  messageType: number;
  serialization: number;
  event: number;
  sessionId?: string;
  connectId?: string;
  payload: Uint8Array;
}): Uint8Array {
  const h = header(opts.messageType, opts.serialization);
  const enc = new TextEncoder();
  const sid = opts.sessionId ? enc.encode(opts.sessionId) : null;
  const cid = opts.connectId ? enc.encode(opts.connectId) : null;

  let total = h.byteLength + 4; // event
  if (cid) total += 4 + cid.byteLength;
  if (sid) total += 4 + sid.byteLength;
  total += 4 + opts.payload.byteLength;

  const out = new Uint8Array(total);
  let off = 0;
  out.set(h, off);
  off += h.byteLength;
  writeU32BE(out, off, opts.event);
  off += 4;
  if (cid) {
    writeU32BE(out, off, cid.byteLength);
    off += 4;
    out.set(cid, off);
    off += cid.byteLength;
  }
  if (sid) {
    writeU32BE(out, off, sid.byteLength);
    off += 4;
    out.set(sid, off);
    off += sid.byteLength;
  }
  writeU32BE(out, off, opts.payload.byteLength);
  off += 4;
  out.set(opts.payload, off);
  return out;
}

export function encodeStartConnection(): Uint8Array {
  return buildClientFrame({
    messageType: DOUBAO_MSG_TYPE.FULL_CLIENT_REQUEST,
    serialization: SER_JSON,
    event: DOUBAO_EVENT.StartConnection,
    payload: new TextEncoder().encode("{}"),
  });
}

export function encodeFinishConnection(): Uint8Array {
  return buildClientFrame({
    messageType: DOUBAO_MSG_TYPE.FULL_CLIENT_REQUEST,
    serialization: SER_JSON,
    event: DOUBAO_EVENT.FinishConnection,
    payload: new TextEncoder().encode("{}"),
  });
}

export function encodeStartSession(sessionId: string, payloadJson: unknown): Uint8Array {
  return buildClientFrame({
    messageType: DOUBAO_MSG_TYPE.FULL_CLIENT_REQUEST,
    serialization: SER_JSON,
    event: DOUBAO_EVENT.StartSession,
    sessionId,
    payload: new TextEncoder().encode(JSON.stringify(payloadJson ?? {})),
  });
}

export function encodeFinishSession(sessionId: string): Uint8Array {
  return buildClientFrame({
    messageType: DOUBAO_MSG_TYPE.FULL_CLIENT_REQUEST,
    serialization: SER_JSON,
    event: DOUBAO_EVENT.FinishSession,
    sessionId,
    payload: new TextEncoder().encode("{}"),
  });
}

export function encodeAudioTask(sessionId: string, pcmS16le16k: Uint8Array): Uint8Array {
  return buildClientFrame({
    messageType: DOUBAO_MSG_TYPE.AUDIO_ONLY_CLIENT,
    serialization: SER_RAW,
    event: DOUBAO_EVENT.TaskRequest,
    sessionId,
    payload: pcmS16le16k,
  });
}

export function encodeClientInterrupt(sessionId: string): Uint8Array {
  return buildClientFrame({
    messageType: DOUBAO_MSG_TYPE.FULL_CLIENT_REQUEST,
    serialization: SER_JSON,
    event: DOUBAO_EVENT.ClientInterrupt,
    sessionId,
    payload: new TextEncoder().encode("{}"),
  });
}

export type DoubaoServerFrame = {
  messageType: number;
  event: number | null;
  sessionId: string | null;
  connectId: string | null;
  jsonPayload: Record<string, unknown> | null;
  binaryPayload: Uint8Array | null;
  errorCode: number | null;
};

export function decodeServerFrame(data: Uint8Array): DoubaoServerFrame | null {
  if (data.byteLength < 4) return null;
  const headerSize = (data[0]! & 0x0f) * 4 || 4;
  const messageType = (data[1]! >> 4) & 0x0f;
  const flags = data[1]! & 0x0f;
  const ser = (data[2]! >> 4) & 0x0f;
  let off = headerSize;

  let errorCode: number | null = null;
  if (messageType === DOUBAO_MSG_TYPE.ERROR_INFO) {
    if (off + 4 > data.byteLength) return null;
    errorCode = readU32BE(data, off);
    off += 4;
  }

  // sequence is unused in dialogue spec but tolerate presence
  if (flags & 0b0001 || flags & 0b0010) {
    if (off + 4 > data.byteLength) return null;
    off += 4;
  }

  let event: number | null = null;
  if (flags & 0b0100) {
    if (off + 4 > data.byteLength) return null;
    event = readU32BE(data, off);
    off += 4;
  }

  let connectId: string | null = null;
  let sessionId: string | null = null;

  // Connect-class server events (50/51/52) carry connect_id; Session-class carry session_id.
  const isConnectEvent = event === 50 || event === 51 || event === 52;
  if (isConnectEvent && event !== null) {
    if (off + 4 > data.byteLength) return null;
    const cidSize = readU32BE(data, off);
    off += 4;
    if (off + cidSize > data.byteLength) return null;
    connectId = new TextDecoder().decode(data.subarray(off, off + cidSize));
    off += cidSize;
  } else if (event !== null) {
    // Some upstream events are documented as Session-class but may omit the
    // session_id field in practice. Do not blindly treat the next u32 as
    // session_id length: for no-session-id frames it is actually payload_size,
    // which previously caused ASRResponse frames to be dropped before payload
    // parsing. Only consume a plausible textual session id.
    if (off + 8 <= data.byteLength) {
      const sidSize = readU32BE(data, off);
      const sidStart = off + 4;
      const sidEnd = sidStart + sidSize;
      const leavesPayloadSize = sidEnd + 4 <= data.byteLength;
      if (sidSize > 0 && sidSize <= 128 && leavesPayloadSize) {
        const candidate = new TextDecoder().decode(data.subarray(sidStart, sidEnd));
        if (/^[A-Za-z0-9._:-]+$/.test(candidate)) {
          sessionId = candidate;
          off = sidEnd;
        }
      }
    }
  }

  if (off + 4 > data.byteLength) return null;
  const plen = readU32BE(data, off);
  off += 4;
  if (off + plen > data.byteLength) return null;
  const payload = data.subarray(off, off + plen);

  let jsonPayload: Record<string, unknown> | null = null;
  let binaryPayload: Uint8Array | null = null;
  if (ser === SER_JSON && payload.byteLength) {
    try {
      const txt = new TextDecoder().decode(payload);
      const parsed = JSON.parse(txt);
      if (parsed && typeof parsed === "object") jsonPayload = parsed as Record<string, unknown>;
    } catch {
      // ignore json decode failures
    }
  } else {
    binaryPayload = payload;
  }

  return { messageType, event, sessionId, connectId, jsonPayload, binaryPayload, errorCode };
}
