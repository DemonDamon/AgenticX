/**
 * App full-chain perf: login -> create session -> chat completion.
 *
 * Maps to acceptance spec section 1.1.13 (200 concurrent login + chat).
 * AC target on 4C/8G: P95 <= 800ms; local dev uses relaxed thresholds.
 *
 * Prerequisites:
 *   - web-portal running (default http://127.0.0.1:3000)
 *   - gateway reachable from portal (GATEWAY_COMPLETIONS_URL)
 *   - For isolated baseline: bash enterprise/scripts/perf/run-app-baseline.sh
 *
 * Usage:
 *   APP_PERF_PASSWORD=change-me k6 run enterprise/scripts/perf/app-login-chat-200.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import {
  appBase,
  appCreateSession,
  appLogin,
  appRamp200Scenario,
  portalChatPayload,
} from "./lib/k6-common.js";

export const options = {
  scenarios: appRamp200Scenario("app_login_chat_200"),
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<5000"],
  },
};

function parseSessionId(bodyText) {
  try {
    const body = JSON.parse(bodyText);
    return body?.data?.session?.id || "";
  } catch {
    return "";
  }
}

export default function main() {
  const jar = http.cookieJar();

  const loginRes = appLogin(jar);
  check(loginRes, {
    "login 200": (r) => r.status === 200,
    "login ok code": (r) => {
      try {
        return JSON.parse(r.body).code === "00000";
      } catch {
        return false;
      }
    },
  });
  if (loginRes.status !== 200) {
    sleep(1);
    return;
  }

  const sessionRes = appCreateSession(jar);
  const sessionId = parseSessionId(sessionRes.body);
  check(sessionRes, {
    "create session 200": (r) => r.status === 200,
    "session id present": () => Boolean(sessionId),
  });
  if (!sessionId) {
    sleep(1);
    return;
  }

  const chatRes = http.post(`${appBase()}/api/chat/completions`, portalChatPayload("perf app login chat ping"), {
    headers: {
      "Content-Type": "application/json",
      "x-chat-session-id": sessionId,
    },
    jar,
    tags: { scenario: "app_chat" },
  });
  check(chatRes, {
    "chat 200": (r) => r.status === 200,
    "chat body non-empty": (r) => typeof r.body === "string" && r.body.length > 0,
  });
  sleep(0.5);
}
