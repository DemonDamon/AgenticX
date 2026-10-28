/**
 * Data Suite A6 board e2e (Playwright)
 *
 * Prerequisite: admin-console on :3001 with seeded admin user.
 *
 * Run:
 *   pnpm -C enterprise exec tsx scripts/e2e-data-boards.ts
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const ADMIN_BASE = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3001";
const ADMIN_PASSWORD =
  process.env.ADMIN_CONSOLE_LOGIN_PASSWORD?.trim() ||
  process.env.AUTH_DEV_OWNER_PASSWORD?.trim() ||
  "ChangeMe_Dev14!Aa";
const SHOT_DIR =
  process.env.A6_E2E_SHOT_DIR ??
  path.resolve(__dirname, "../..", "docs/agx-data-suite/shots");

async function adminLogin(page: import("playwright").Page): Promise<void> {
  await page.goto(`${ADMIN_BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator('input[type="email"]').first().fill("admin@agenticx.local");
  await page.locator('input[type="password"]').first().fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /登录并进入控制台|Sign in to console/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await adminLogin(page);
    await page.goto(`${ADMIN_BASE}/admin/data-boards`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByTestId("data-boards-page").waitFor({ state: "visible", timeout: 20_000 });
    await page.getByTestId("data-boards-title").waitFor({ state: "visible", timeout: 10_000 });
    const title = (await page.getByTestId("data-boards-title").innerText()).trim();
    if (!title.includes("Member overview")) {
      throw new Error(`unexpected board title: ${title}`);
    }
    await page.getByTestId("data-boards-widget-members_by_region").waitFor({ state: "visible" });
    await page.screenshot({ path: path.join(SHOT_DIR, "a6-data-boards-root.png"), fullPage: true });

    // Drill into brand=A
    await page.getByTestId("data-boards-drill-A").click();
    await page.getByTestId("data-boards-drill-path").waitFor({ state: "visible" });
    const pathText = await page.getByTestId("data-boards-drill-path").innerText();
    if (!pathText.includes("A")) throw new Error(`drill path missing A: ${pathText}`);
    await page.screenshot({ path: path.join(SHOT_DIR, "a6-data-boards-drill-A.png"), fullPage: true });

    // Compare toggle
    await page.getByTestId("data-boards-compare").click();
    const compareLabel = (await page.getByTestId("data-boards-compare").innerText()).trim();
    if (!/对比：开|Compare: on/i.test(compareLabel)) {
      throw new Error(`compare not on: ${compareLabel}`);
    }
    await page.screenshot({ path: path.join(SHOT_DIR, "a6-data-boards-compare.png"), fullPage: true });

    console.log("[e2e-data-boards] ok: title, widgets, drill, compare");
    console.log(`[e2e-data-boards] shots: ${SHOT_DIR}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("[e2e-data-boards] failed:", e);
  process.exitCode = 1;
});
