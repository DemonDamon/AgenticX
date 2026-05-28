import test from "node:test";
import assert from "node:assert/strict";
import { floatFrameToTargetPcm16, httpBaseToWs } from "./pcm-utils.ts";

test("httpBaseToWs converts http and https", () => {
  assert.equal(httpBaseToWs("http://127.0.0.1:65133"), "ws://127.0.0.1:65133");
  assert.equal(httpBaseToWs("https://example.com/api/"), "wss://example.com/api");
});

test("floatFrameToTargetPcm16 downsamples to pcm16 bytes", () => {
  const src = new Float32Array([0, 0.5, -0.5, 1]);
  const out = floatFrameToTargetPcm16(src, 48000, 16000);
  assert.equal(out.byteLength % 2, 0);
  assert.ok(out.byteLength > 0);
});
