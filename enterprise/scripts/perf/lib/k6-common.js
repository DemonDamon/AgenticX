/**
 * Shared helpers for gateway perf k6 scripts.
 */
export function gatewayBase() {
  return __ENV.GATEWAY_PERF_BASE || "http://127.0.0.1:18088";
}

export function bearerToken() {
  const token = __ENV.GATEWAY_PERF_BEARER || "";
  if (!token) {
    throw new Error("GATEWAY_PERF_BEARER is required");
  }
  return token;
}

export function chatHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${bearerToken()}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export function chatPayload(content, stream = false) {
  return JSON.stringify({
    model: __ENV.GATEWAY_PERF_MODEL || "perf-mock-model",
    messages: [{ role: "user", content }],
    stream,
    temperature: 0,
  });
}

export function defaultThresholds() {
  const p95 = Number(__ENV.PERF_K6_P95_MS || 5000);
  return {
    http_req_failed: ["rate<0.02"],
    http_req_duration: [`p(95)<${p95}`],
  };
}

export function rampScenario(name, targetVUs) {
  const duration = __ENV.PERF_K6_DURATION || "30s";
  const ramp = __ENV.PERF_K6_RAMP || "10s";
  return {
    [name]: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: ramp, target: targetVUs },
        { duration, target: targetVUs },
      ],
      gracefulRampDown: "5s",
    },
  };
}
