/**
 * Rules & Knowledge P1 R2 — portal disambiguation choice-panel e2e (Playwright)
 *
 * Prerequisite: web-portal on :3000 with a login-capable session (or AUTH bypass).
 *
 * Run:
 *   set -a && source enterprise/.env.local && set +a
 *   pnpm -C enterprise exec tsx scripts/e2e-portal-disambiguation.ts
 *
 * If portal login credentials are unavailable, store vitest remains the required gate.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const PORTAL_BASE = process.env.PORTAL_BASE_URL ?? "http://127.0.0.1:3000";
const PORTAL_EMAIL =
  process.env.PORTAL_LOGIN_EMAIL?.trim() ||
  process.env.ADMIN_CONSOLE_LOGIN_EMAIL?.trim() ||
  "admin@agenticx.local";
const PORTAL_PASSWORD =
  process.env.PORTAL_LOGIN_PASSWORD?.trim() ||
  process.env.ADMIN_CONSOLE_LOGIN_PASSWORD?.trim() ||
  process.env.AUTH_DEV_OWNER_PASSWORD?.trim() ||
  "ChangeMe_Dev14!Aa";
const SHOT_DIR =
  process.env.PORTAL_DISAMBIGUATION_E2E_SHOT_DIR ??
  path.resolve(__dirname, "../..", "docs/agx-rules-knowledge-suite/e2e-shots");

async function dismissNextOverlay(page: import("playwright").Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
  }).catch(() => undefined);
}

async function portalLogin(page: import("playwright").Page): Promise<void> {
  await page.goto(`${PORTAL_BASE}/auth`, { waitUntil: "networkidle", timeout: 60_000 });
  await dismissNextOverlay(page);
  const email = page.locator('input[type="email"]').first();
  const password = page.locator('input[type="password"]').first();
  await email.waitFor({ state: "visible", timeout: 20_000 });
  await email.fill(PORTAL_EMAIL);
  await password.fill(PORTAL_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/workspace/, { timeout: 45_000 }),
    page.locator('button[type="submit"]').first().click({ force: true }),
  ]);
}

async function openMode(
  page: import("playwright").Page,
  row: string,
  mode: string,
): Promise<void> {
  await dismissNextOverlay(page);
  await page.getByTestId(`portal-disambiguation-row-${row}`).click({ force: true });
  // Panel may already be visible with the previous mode — wait for data-mode flip.
  await page
    .locator(`[data-testid="portal-disambiguation-choice-panel"][data-mode="${mode}"]`)
    .waitFor({ state: "visible", timeout: 15_000 });
  await page
    .getByTestId("portal-disambiguation-detail-id")
    .filter({ hasText: row })
    .waitFor({ state: "visible", timeout: 10_000 });
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  try {
    await portalLogin(page);
    await page.goto(`${PORTAL_BASE}/workspace/disambiguation`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.getByTestId("portal-disambiguation-page").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    const reseed = page.getByTestId("portal-disambiguation-reseed");
    if (await reseed.isVisible().catch(() => false)) {
      for (let i = 0; i < 40; i++) {
        if (await reseed.isEnabled().catch(() => false)) break;
        await page.waitForTimeout(250);
      }
      await reseed.click({ force: true });
      await page.waitForTimeout(1000);
      await page.getByTestId("portal-disambiguation-table").waitFor({
        state: "visible",
        timeout: 15_000,
      });
    }

    // Shot 13: candidate_select — check a candidate so pixels differ from empty
    await openMode(page, "das-brand-a-candidate", "candidate_select");
    await page
      .getByTestId("portal-disambiguation-candidate-brand-a-pump-01")
      .check({ force: true });
    await page.waitForTimeout(250);
    const shot13 = "13-portal-disambiguation-candidate-select.png";
    await page.screenshot({ path: path.join(SHOT_DIR, shot13), fullPage: true });
    console.log("shot", shot13, "mode", "candidate_select");

    // Shot 14: info_supplement
    await openMode(page, "das-brand-a-supplement", "info_supplement");
    await page
      .getByTestId("portal-disambiguation-free-text")
      .fill("ops-channel-brand-a");
    await page.waitForTimeout(250);
    const shot14 = "14-portal-disambiguation-info-supplement.png";
    await page.screenshot({ path: path.join(SHOT_DIR, shot14), fullPage: true });
    console.log("shot", shot14, "mode", "info_supplement");

    // Shot 15: conflict_resolve
    await openMode(page, "das-brand-a-conflict", "conflict_resolve");
    await page
      .getByTestId("portal-disambiguation-candidate-val-plant-a")
      .check({ force: true });
    await page.waitForTimeout(250);
    const shot15 = "15-portal-disambiguation-conflict-resolve.png";
    await page.screenshot({ path: path.join(SHOT_DIR, shot15), fullPage: true });
    console.log("shot", shot15, "mode", "conflict_resolve");

    const hashes = [shot13, shot14, shot15].map((name) => {
      const buf = fs.readFileSync(path.join(SHOT_DIR, name));
      const md5 = crypto.createHash("md5").update(buf).digest("hex");
      console.log("md5", name, md5);
      return md5;
    });
    if (new Set(hashes).size !== hashes.length) {
      throw new Error(`portal shots 13-15 must have distinct MD5s: ${hashes.join(",")}`);
    }
    console.log("portal-disambiguation e2e ok; sessions modes exercised");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
