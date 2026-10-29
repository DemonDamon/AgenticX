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
      await page.waitForTimeout(800);
    }

    const modes: Array<{ row: string; shot: string; mode: string }> = [
      {
        row: "das-brand-a-candidate",
        shot: "13-portal-disambiguation-candidate-select.png",
        mode: "candidate_select",
      },
      {
        row: "das-brand-a-supplement",
        shot: "14-portal-disambiguation-info-supplement.png",
        mode: "info_supplement",
      },
      {
        row: "das-brand-a-conflict",
        shot: "15-portal-disambiguation-conflict-resolve.png",
        mode: "conflict_resolve",
      },
    ];

    for (const m of modes) {
      await page.getByTestId(`portal-disambiguation-row-${m.row}`).click({ force: true });
      const panel = page.getByTestId("portal-disambiguation-choice-panel");
      await panel.waitFor({ state: "visible", timeout: 15_000 });
      const modeAttr = await panel.getAttribute("data-mode");
      if (modeAttr !== m.mode) {
        throw new Error(`expected mode ${m.mode}, got ${modeAttr}`);
      }
      await page.screenshot({
        path: path.join(SHOT_DIR, m.shot),
        fullPage: true,
      });
      console.log("shot", m.shot, "mode", m.mode);
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
