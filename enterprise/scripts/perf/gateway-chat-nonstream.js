/**
 * Gateway /v1/chat/completions non-stream perf (mock upstream, zero model delay).
 *
 * Usage:
 *   GATEWAY_PERF_BEARER=$(...) k6 run enterprise/scripts/perf/gateway-chat-nonstream.js
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

const VUS = Number(__ENV.PERF_K6_VUS || 20);

export const options = {
  scenarios: rampScenario("chat_nonstream", VUS),
  thresholds: defaultThresholds(),
};

export default function main() {
  const res = http.post(`${gatewayBase()}/v1/chat/completions`, chatPayload("perf non-stream ping"), {
    headers: chatHeaders(),
    tags: { scenario: "nonstream" },
  });
  check(res, {
    "status 200": (r) => r.status === 200,
    "has usage": (r) => {
      try {
        const body = r.json();
        return body.usage && body.usage.total_tokens > 0;
      } catch {
        return false;
      }
    },
  });
  sleep(0.2);
}
