/**
 * Rules & Knowledge P1 R2 — disambiguation choice-panel admin e2e (Playwright)
 *
 * Prerequisite: admin-console on :3001 with seeded admin user.
 *
 * Run:
 *   set -a && source enterprise/.env.local && set +a
 *   pnpm -C enterprise exec tsx scripts/e2e-disambiguation.ts
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const ADMIN_BASE = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3001";
const ADMIN_EMAIL =
  process.env.ADMIN_CONSOLE_LOGIN_EMAIL?.trim() || "admin@agenticx.local";
const ADMIN_PASSWORD =
  process.env.ADMIN_CONSOLE_LOGIN_PASSWORD?.trim() ||
  process.env.AUTH_DEV_OWNER_PASSWORD?.trim() ||
  "ChangeMe_Dev14!Aa";
const SHOT_DIR =
  process.env.DISAMBIGUATION_E2E_SHOT_DIR ??
  path.resolve(__dirname, "../..", "docs/agx-rules-knowledge-suite/e2e-shots");

async function dismissNextOverlay(page: import("playwright").Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
    const buttons = Array.from(document.querySelectorAll("button"));
    for (const b of buttons) {
      const t = (b.textContent || "").trim();
      if (/Close|Dismiss|×|关闭/.test(t)) b.click();
    }
  }).catch(() => undefined);
}

async function adminLogin(page: import("playwright").Page): Promise<void> {
  await page.goto(`${ADMIN_BASE}/login`, { waitUntil: "networkidle", timeout: 60_000 });
  await dismissNextOverlay(page);
  const email = page.locator('input[type="email"]').first();
  const password = page.locator('input[type="password"]').first();
  await email.waitFor({ state: "visible", timeout: 20_000 });
  await email.click({ force: true });
  await email.fill("");
  await email.fill(ADMIN_EMAIL);
  await password.click({ force: true });
  await password.fill("");
  await password.fill(ADMIN_PASSWORD);
  await page.waitForTimeout(300);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 45_000 }),
    page.getByRole("button", { name: /登录并进入控制台|Sign in to console/i }).click({ force: true }),
  ]);
}

async function waitPage(page: import("playwright").Page): Promise<void> {
  await page.getByTestId("disambiguation-page").waitFor({ state: "visible", timeout: 30_000 });
  const loading = page.getByText(/加载消歧会话|Loading disambiguation/i);
  try {
    await loading.waitFor({ state: "hidden", timeout: 20_000 });
  } catch {
    // ok
  }
  await page.getByTestId("disambiguation-table").waitFor({ state: "visible", timeout: 20_000 });
}

async function openRow(
  page: import("playwright").Page,
  rowId: string,
): Promise<void> {
  await dismissNextOverlay(page);
  await page.getByTestId(`disambiguation-row-${rowId}`).click({ force: true });
  await page.getByTestId("disambiguation-choice-panel").waitFor({ state: "visible", timeout: 15_000 });
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
    await adminLogin(page);
    await page.goto(`${ADMIN_BASE}/admin/disambiguation`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await waitPage(page);
    await dismissNextOverlay(page);

    // Ensure Brand-A samples exist (wait for busy to clear)
    const reseed = page.getByTestId("disambiguation-reseed");
    if (await reseed.isVisible().catch(() => false)) {
      await reseed.waitFor({ state: "visible", timeout: 10_000 });
      // wait until enabled
      for (let i = 0; i < 40; i++) {
        if (await reseed.isEnabled().catch(() => false)) break;
        await page.waitForTimeout(250);
      }
      await dismissNextOverlay(page);
      await reseed.click({ force: true });
      await page.waitForTimeout(1000);
      await waitPage(page);
    }

    const rowCount = await page.locator('[data-testid="disambiguation-table"] tbody tr').count();
    if (rowCount < 1) throw new Error("disambiguation list empty");
    console.log(`[e2e-disambiguation] sessions=${rowCount}`);

    // Shot 07: candidate_select — do not submit; keep panel open for shot
    await openRow(page, "das-brand-a-candidate");
    await page.getByTestId("disambiguation-candidate-brand-a-pump-01").check({ force: true });
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(SHOT_DIR, "07-disambiguation-candidate-select.png"),
      fullPage: true,
    });
    console.log("[e2e-disambiguation] shot 07 ok");

    // Shot 08: info_supplement
    await openRow(page, "das-brand-a-supplement");
    await page.getByTestId("disambiguation-free-text").fill("ops-channel-brand-a");
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(SHOT_DIR, "08-disambiguation-info-supplement.png"),
      fullPage: true,
    });
    console.log("[e2e-disambiguation] shot 08 ok");

    // Shot 09: conflict_resolve
    await openRow(page, "das-brand-a-conflict");
    await page.getByTestId("disambiguation-candidate-val-plant-a").check({ force: true });
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(SHOT_DIR, "09-disambiguation-conflict-resolve.png"),
      fullPage: true,
    });
    console.log("[e2e-disambiguation] shot 09 ok");

    // Smoke: submit conflict + reseed restores samples
    await dismissNextOverlay(page);
    await page.getByTestId("disambiguation-submit").click({ force: true });
    await page.waitForTimeout(1200);
    await dismissNextOverlay(page);
    const reseed2 = page.getByTestId("disambiguation-reseed");
    for (let i = 0; i < 40; i++) {
      if (await reseed2.isEnabled().catch(() => false)) break;
      await page.waitForTimeout(250);
    }
    await reseed2.click({ force: true });
    await page.waitForTimeout(1000);
    await waitPage(page);
    const after = await page.locator('[data-testid="disambiguation-table"] tbody tr').count();
    console.log(`[e2e-disambiguation] after reseed sessions=${after}`);

    const sourceText = await page.getByTestId("disambiguation-source").innerText().catch(() => "");
    console.log(`[e2e-disambiguation] source note: ${sourceText}`);
    console.log(`[e2e-disambiguation] shots → ${SHOT_DIR}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[e2e-disambiguation] FAILED", err);
  process.exit(1);
});
