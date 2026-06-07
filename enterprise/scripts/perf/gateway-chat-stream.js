/**
 * Gateway /v1/chat/completions streaming perf.
 */
import http from "k6/http";
import { check, sleep } from "k6";
import {
  chatHeaders,
  chatPayload,
  defaultThresholds,
  gatewayBase,
  rampScenario,
} from "./lib/k6-common.js";

const VUS = Number(__ENV.PERF_K6_VUS || 15);

export const options = {
  scenarios: rampScenario("chat_stream", VUS),
  thresholds: defaultThresholds(),
};

export default function main() {
  const res = http.post(`${gatewayBase()}/v1/chat/completions`, chatPayload("perf stream ping", true), {
    headers: chatHeaders({ Accept: "text/event-stream" }),
    tags: { scenario: "stream" },
  });
  check(res, {
    "status 200": (r) => r.status === 200,
    "sse body": (r) => typeof r.body === "string" && r.body.includes("data:"),
  });
  sleep(0.2);
}
