import assert from "node:assert/strict";
import test from "node:test";

import { DOUBAO_EVENT, encodeChatTtsText } from "./doubao-wire.ts";

function readU32BE(buf: Uint8Array, offset: number): number {
  return new DataView(buf.buffer, buf.byteOffset + offset, 4).getUint32(0, false);
}

test("ChatTTSText uses event 500 with session id and JSON payload", () => {
  const sessionId = "s-test";
  const frame = encodeChatTtsText(sessionId, {
    start: true,
    content: "你稍等，我执行下。",
    end: false,
  });

  assert.equal(readU32BE(frame, 4), DOUBAO_EVENT.ChatTTSText);

  const sidSize = readU32BE(frame, 8);
  const sidStart = 12;
  const sidEnd = sidStart + sidSize;
  assert.equal(new TextDecoder().decode(frame.subarray(sidStart, sidEnd)), sessionId);

  const payloadSize = readU32BE(frame, sidEnd);
  const payloadStart = sidEnd + 4;
  const payload = JSON.parse(new TextDecoder().decode(frame.subarray(payloadStart, payloadStart + payloadSize)));
  assert.deepEqual(payload, {
    start: true,
    content: "你稍等，我执行下。",
    end: false,
  });
});
