/**
 * Rules & Knowledge P0 — rule-governance admin e2e (Playwright)
 *
 * Prerequisite: admin-console on :3001 with seeded admin user + rules store.
 *
 * Run (from repo root):
 *   set -a && source enterprise/.env.local && set +a
 *   pnpm -C enterprise exec tsx scripts/e2e-rule-governance.ts
 *
 * Screenshots land in docs/agx-rules-knowledge-suite/e2e-shots/ (HD 1920x1080 @2x).
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
  process.env.RULES_E2E_SHOT_DIR ??
  path.resolve(__dirname, "../..", "docs/agx-rules-knowledge-suite/e2e-shots");

async function waitPastLoading(page: import("playwright").Page): Promise<void> {
  // Wait until list is not in loading state and table or detail is visible.
  await page.getByTestId("rule-governance-page").waitFor({ state: "visible", timeout: 30_000 });
  const loading = page.getByText(/加载规则中|Loading rules/i);
  try {
    await loading.waitFor({ state: "hidden", timeout: 20_000 });
  } catch {
    // may never have shown
  }
  await page.getByTestId("rule-governance-list").waitFor({ state: "visible", timeout: 20_000 });
  await page.getByTestId("rule-governance-table").waitFor({ state: "visible", timeout: 20_000 });
}

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
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  try {
    await adminLogin(page);

    await page.goto(`${ADMIN_BASE}/admin/rule-governance`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await waitPastLoading(page);

    const rowCount = await page.locator('[data-testid="rule-governance-table"] tbody tr').count();
    if (rowCount < 1) {
      throw new Error("rule list has no rows");
    }
    console.log(`[e2e-rule-governance] list rows=${rowCount}`);

    // Prefer Brand-A temp threshold row; fall back to first row.
    const prefer = page.getByTestId("rule-governance-row-brand-a-temp-threshold");
    if (await prefer.isVisible().catch(() => false)) {
      await prefer.click();
    } else {
      await page.locator('[data-testid="rule-governance-table"] tbody tr').first().click();
    }

    await page.getByTestId("rule-governance-detail").waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("rule-governance-detail-id").waitFor({ state: "visible", timeout: 15_000 });
    // Give executions panel a beat to settle
    await page.waitForTimeout(500);

    const sourceText = await page.getByTestId("rule-governance-source").innerText().catch(() => "");
    console.log(`[e2e-rule-governance] source note: ${sourceText}`);

    await page.screenshot({
      path: path.join(SHOT_DIR, "01-rule-governance-list.png"),
      fullPage: true,
    });

    // Detail-focused crop via second shot after scrolling detail into view
    await page.getByTestId("rule-governance-detail").scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.screenshot({
      path: path.join(SHOT_DIR, "02-rule-governance-detail.png"),
      fullPage: true,
    });

    const executions = page.getByTestId("rule-governance-executions");
    if (await executions.isVisible().catch(() => false)) {
      await executions.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(SHOT_DIR, "03-rule-governance-executions.png"),
        fullPage: true,
      });
      console.log("[e2e-rule-governance] executions panel visible");
    } else {
      console.warn("[e2e-rule-governance] no executions panel (empty or stub); list+detail shots still taken");
    }

    console.log(`[e2e-rule-governance] shots → ${SHOT_DIR}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[e2e-rule-governance] FAILED", err);
  process.exit(1);
});
