/**
 * Data Suite H6 DataFlow jobs ops e2e (Playwright)
 *
 * Asserts:
 * 1) /admin/data-jobs page loads with seeded golden job
 * 2) 触发调度 → run history shows schedule/succeeded
 * 3) 重跑 → history includes manual/succeeded
 *
 * Sources enterprise/.env.local for admin password.
 *
 * Run:
 *   set -a && source enterprise/.env.local && set +a
 *   pnpm -C enterprise exec tsx scripts/e2e-data-jobs.ts
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

function loadEnvLocal(): void {
  const candidates = [
    path.resolve(__dirname, "../.env.local"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "enterprise/.env.local"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
    break;
  }
}

loadEnvLocal();

const ADMIN_BASE = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3001";
const ADMIN_EMAIL =
  process.env.ADMIN_CONSOLE_LOGIN_EMAIL?.trim() || "admin@agenticx.local";
const ADMIN_PASSWORD =
  process.env.ADMIN_CONSOLE_LOGIN_PASSWORD?.trim() ||
  process.env.AUTH_DEV_OWNER_PASSWORD?.trim() ||
  "ChangeMe_Dev14!Aa";
const SHOT_DIR =
  process.env.H6_E2E_SHOT_DIR ??
  path.resolve(__dirname, "../..", "docs/agx-data-suite/shots");

async function adminLogin(page: import("playwright").Page): Promise<void> {
  await page.goto(`${ADMIN_BASE}/login`, { waitUntil: "networkidle", timeout: 60_000 });
  const email = page.locator('input[type="email"]').first();
  const password = page.locator('input[type="password"]').first();
  await email.waitFor({ state: "visible", timeout: 20_000 });
  await email.click();
  await email.fill("");
  await email.fill(ADMIN_EMAIL);
  await password.click();
  await password.fill("");
  await password.fill(ADMIN_PASSWORD);
  await page.waitForTimeout(300);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 45_000 }),
    page.getByRole("button", { name: /登录并进入控制台|Sign in to console/i }).click(),
  ]);
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    await adminLogin(page);
    await page.goto(`${ADMIN_BASE}/admin/data-jobs`, {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
    await page.getByTestId("data-jobs-page").waitFor({ state: "visible", timeout: 30_000 });
    await page.getByTestId("data-jobs-row-golden_path_members").waitFor({
      state: "visible",
      timeout: 20_000,
    });

    // API path: tick → history → rerun
    const tickProbe = await page.evaluate(async () => {
      const tick = await fetch("/api/admin/data-suite/jobs/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "tick", job_id: "golden_path_members" }),
      });
      const tickJson = await tick.json();
      const list = await fetch("/api/admin/data-suite/jobs/runs?job_id=golden_path_members");
      const listJson = await list.json();
      const rerun = await fetch("/api/admin/data-suite/jobs/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "rerun", job_id: "golden_path_members" }),
      });
      const rerunJson = await rerun.json();
      return {
        tickStatus: tick.status,
        tickOk: tickJson?.data?.runs?.[0]?.status === "succeeded",
        tickTrigger: tickJson?.data?.runs?.[0]?.trigger,
        historyCount: listJson?.data?.runs?.length ?? 0,
        rerunStatus: rerun.status,
        rerunOk: rerunJson?.data?.run?.status === "succeeded",
        rerunTrigger: rerunJson?.data?.run?.trigger,
      };
    });

    if (tickProbe.tickStatus !== 200 || !tickProbe.tickOk || tickProbe.tickTrigger !== "schedule") {
      throw new Error(`tick failed: ${JSON.stringify(tickProbe)}`);
    }
    if (tickProbe.historyCount < 1) {
      throw new Error(`history empty after tick: ${JSON.stringify(tickProbe)}`);
    }
    if (tickProbe.rerunStatus !== 200 || !tickProbe.rerunOk || tickProbe.rerunTrigger !== "manual") {
      throw new Error(`rerun failed: ${JSON.stringify(tickProbe)}`);
    }

    // UI buttons
    await page.getByTestId("data-jobs-tick").click();
    await page.waitForTimeout(800);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("data-jobs-runs-table").waitFor({ state: "visible", timeout: 20_000 });
    const runCount = await page.locator("[data-testid^='data-jobs-run-']").count();
    if (runCount < 1) throw new Error("UI run history empty after tick");

    await page.screenshot({
      path: path.join(SHOT_DIR, "h6-data-jobs.png"),
      fullPage: true,
    });

    console.log("e2e-data-jobs: ok", tickProbe, { runCount });
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("e2e-data-jobs failed:", err);
  process.exit(1);
});
