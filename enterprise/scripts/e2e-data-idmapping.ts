/**
 * Data Suite H7 ID-Mapping admin e2e (Playwright)
 *
 * Asserts:
 * 1) /admin/data-idmapping loads with sample profile (phone + email)
 * 2) sample merge → conflict queue non-empty
 * 3) adjudicate keep_value → conflict resolved
 *
 * Sources enterprise/.env.local for admin password.
 *
 * Run:
 *   set -a && source enterprise/.env.local && set +a
 *   pnpm -C enterprise exec tsx scripts/e2e-data-idmapping.ts
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
  process.env.H7_E2E_SHOT_DIR ??
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
    await page.goto(`${ADMIN_BASE}/admin/data-idmapping`, {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
    await page.getByTestId("data-idmapping-page").waitFor({ state: "visible", timeout: 30_000 });
    await page.getByTestId("data-idmapping-profile-demo_fake_ids").waitFor({
      state: "visible",
      timeout: 20_000,
    });

    const probe = await page.evaluate(async () => {
      const merge = await fetch("/api/admin/data-suite/idmapping/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ use_sample: true }),
      });
      const mergeJson = await merge.json();
      const list = await fetch("/api/admin/data-suite/idmapping/conflicts?status=open");
      const listJson = await list.json();
      const cfl = listJson?.data?.conflicts?.[0];
      let resolveStatus = 0;
      let resolveOk = false;
      if (cfl) {
        const resolve = await fetch("/api/admin/data-suite/idmapping/conflicts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            conflict_id: cfl.id,
            decision: "keep_value",
            chosen_value: cfl.values?.[0],
            note: "e2e",
          }),
        });
        resolveStatus = resolve.status;
        const resolveJson = await resolve.json();
        resolveOk = resolveJson?.data?.conflict?.status === "resolved";
      }
      return {
        mergeStatus: merge.status,
        conflictCount: mergeJson?.data?.result?.conflicts?.length ?? 0,
        openCount: listJson?.data?.conflicts?.length ?? 0,
        resolveStatus,
        resolveOk,
        snapshotId: mergeJson?.data?.result?.snapshot_id ?? null,
      };
    });

    if (probe.mergeStatus !== 200 || probe.conflictCount < 1) {
      throw new Error(`merge failed: ${JSON.stringify(probe)}`);
    }
    if (!probe.resolveOk || probe.resolveStatus !== 200) {
      throw new Error(`resolve failed: ${JSON.stringify(probe)}`);
    }

    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("data-idmapping-conflicts-table").waitFor({
      state: "visible",
      timeout: 20_000,
    });

    await page.screenshot({
      path: path.join(SHOT_DIR, "h7-data-idmapping.png"),
      fullPage: true,
    });

    console.log("e2e-data-idmapping: ok", probe);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("e2e-data-idmapping failed:", err);
  process.exit(1);
});
