import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCitationMarkers } from "./citation-normalize";

test("normalizeCitationMarkers: converts common variants when enabled", () => {
  assert.equal(
    normalizeCitationMarkers("事实【1】与(来源 2)及[来源3]", true),
    "事实[1]与[2]及[3]",
  );
});

test("normalizeCitationMarkers: no-op when disabled", () => {
  const input = "事实【1】";
  assert.equal(normalizeCitationMarkers(input, false), input);
});
