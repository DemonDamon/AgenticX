/**
 * Shared helpers for gateway perf k6 scripts.
 */
import http from "k6/http";

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

/** App full-chain helpers (web-portal login + chat). */
export function appBase() {
  return __ENV.APP_PERF_BASE || "http://127.0.0.1:3000";
}

export function appCredentials() {
  return {
    email: __ENV.APP_PERF_EMAIL || "admin@agenticx.local",
    password: __ENV.APP_PERF_PASSWORD || "change-me",
  };
}

export function appChatModel() {
  return __ENV.APP_PERF_MODEL || "perf-mock/perf-mock-model";
}

export function appLogin(jar) {
  const { email, password } = appCredentials();
  return http.post(
    `${appBase()}/api/auth/login`,
    JSON.stringify({ email, password }),
    {
      headers: { "Content-Type": "application/json" },
      jar,
      tags: { scenario: "app_login" },
    },
  );
}

export function appCreateSession(jar) {
  return http.post(
    `${appBase()}/api/chat/sessions`,
    JSON.stringify({ title: "perf session", active_model: appChatModel() }),
    {
      headers: { "Content-Type": "application/json" },
      jar,
      tags: { scenario: "app_create_session" },
    },
  );
}

export function portalChatPayload(content) {
  return JSON.stringify({
    model: appChatModel(),
    messages: [{ role: "user", content }],
    stream: false,
    temperature: 0,
  });
}

export function appRamp200Scenario(name) {
  return {
    [name]: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "30s", target: 200 },
        { duration: "60s", target: 200 },
      ],
      gracefulRampDown: "30s",
    },
  };
}
