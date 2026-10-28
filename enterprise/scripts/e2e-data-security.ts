/**
 * Data Suite A7 security e2e (Playwright)
 *
 * Prerequisite: admin-console on :3001 with seeded admin user.
 *
 * Run:
 *   pnpm -C enterprise exec tsx scripts/e2e-data-security.ts
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
  process.env.A7_E2E_SHOT_DIR ??
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
    await page.goto(`${ADMIN_BASE}/admin/data-security`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.getByTestId("data-security-page").waitFor({ state: "visible", timeout: 20_000 });
    await page.getByTestId("page-watermark").waitFor({ state: "attached", timeout: 10_000 });
    const masked = (await page.getByTestId("data-security-masked-phone").innerText()).trim();
    if (!masked.includes("1*********8")) {
      throw new Error(`expected analyst partial phone, got: ${masked}`);
    }
    await page.screenshot({
      path: path.join(SHOT_DIR, "a7-data-security.png"),
      fullPage: true,
    });
    console.log("[e2e-data-security] ok: policy page, masked phone, watermark");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("[e2e-data-security] failed:", e);
  process.exitCode = 1;
});
