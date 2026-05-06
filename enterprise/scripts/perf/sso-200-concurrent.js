/**
 * OIDC SSO 并发压测（k6）— FR-C3.1
 *
 * 默认仅对 web-portal `/api/auth/sso/oidc/start` 发起并发（302 到 IdP），
 * 用于衡量应用侧路由与 discovery 准备阶段；完整「回调换票」需接 mock IdP 或录制会话。
 *
 * 用法:
 *   k6 run enterprise/scripts/perf/sso-200-concurrent.js
 *   SSO_K6_BASE=http://127.0.0.1:3000 k6 run enterprise/scripts/perf/sso-200-concurrent.js
 */
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.SSO_K6_BASE || "http://127.0.0.1:3000";

export const options = {
  scenarios: {
    sso_ramp: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "30s", target: 200 },
        { duration: "60s", target: 200 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    // 验收目标（AC-C3.1）：在 4C/8G 机器上 P95 ≤ 800ms；默认阈值为宽松值避免本地 dev 误伤。
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<5000"],
  },
};

export default function main() {
  const res = http.get(`${BASE}/api/auth/sso/oidc/start?provider=default`);
  check(res, {
    "start 302": (r) => r.status === 302,
  });
  sleep(1);
}
