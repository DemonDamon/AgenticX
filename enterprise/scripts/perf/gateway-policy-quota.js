/**
 * Gateway policy + quota path perf.
 * - quota_chat: normal chat (quota gate + policy pass)
 * - policy_block: keyword trigger expects HTTP 403
 */
import http from "k6/http";
import { check, sleep } from "k6";
import {
  chatHeaders,
  chatPayload,
  gatewayBase,
} from "./lib/k6-common.js";

const VUS = Number(__ENV.PERF_K6_VUS || 15);
const duration = __ENV.PERF_K6_DURATION || "30s";
const ramp = __ENV.PERF_K6_RAMP || "10s";

export const options = {
  scenarios: {
    quota_chat: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: ramp, target: VUS },
        { duration, target: VUS },
      ],
      gracefulRampDown: "5s",
      exec: "quotaChat",
    },
    policy_block: {
      executor: "constant-vus",
      vus: Math.max(2, Math.floor(VUS / 5)),
      duration,
      exec: "policyBlock",
    },
  },
  thresholds: {
    "http_req_failed{scenario:quota}": ["rate<0.02"],
    "http_req_duration{scenario:quota}": [`p(95)<${Number(__ENV.PERF_K6_P95_MS || 5000)}`],
    "checks{scenario:policy}": ["rate>0.95"],
  },
};

export function quotaChat() {
  const res = http.post(`${gatewayBase()}/v1/chat/completions`, chatPayload("perf quota path ok"), {
    headers: chatHeaders(),
    tags: { scenario: "quota" },
  });
  check(res, { "quota status 200": (r) => r.status === 200 });
  sleep(0.2);
}

export function policyBlock() {
  const res = http.post(
    `${gatewayBase()}/v1/chat/completions`,
    chatPayload("please evaluate __PERF_POLICY_BLOCK__ marker"),
    {
      headers: chatHeaders(),
      tags: { scenario: "policy" },
    }
  );
  check(res, {
    "policy blocked 403": (r) => r.status === 403,
  });
  sleep(0.5);
}
