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
 * Shots 01/02/03 are element captures (list / detail / executions) so MD5s differ.
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

    // Shot 01: list panel only (before relying on detail selection visuals)
    const list = page.getByTestId("rule-governance-list");
    await list.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await list.screenshot({ path: path.join(SHOT_DIR, "01-rule-governance-list.png") });

    // Prefer Brand-A temp threshold row; fall back to first row.
    const prefer = page.getByTestId("rule-governance-row-brand-a-temp-threshold");
    if (await prefer.isVisible().catch(() => false)) {
      await prefer.click();
    } else {
      await page.locator('[data-testid="rule-governance-table"] tbody tr').first().click();
    }

    await page.getByTestId("rule-governance-detail").waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("rule-governance-detail-id").waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(500);

    const sourceText = await page.getByTestId("rule-governance-source").innerText().catch(() => "");
    console.log(`[e2e-rule-governance] source note: ${sourceText}`);

    // Shot 02: detail panel
    const detail = page.getByTestId("rule-governance-detail");
    await detail.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await detail.screenshot({ path: path.join(SHOT_DIR, "02-rule-governance-detail.png") });

    // Shot 03: executions — must be non-empty when store is seeded (apiSource)
    const executions = page.getByTestId("rule-governance-executions");
    const execVisible = await executions.isVisible().catch(() => false);
    const fromApi = /已从 API 加载|Loaded from API/i.test(sourceText);
    if (!execVisible) {
      throw new Error(
        fromApi
          ? "claiming seeded/API rules but executions empty (shot 03 requires non-empty executions)"
          : "rule-governance-executions not visible (seed Brand-A executions.json required)",
      );
    }
    const execItems = await executions.locator("li").count();
    if (execItems < 1) {
      throw new Error("claiming seeded executions but list is empty");
    }
    await executions.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await executions.screenshot({
      path: path.join(SHOT_DIR, "03-rule-governance-executions.png"),
    });
    console.log(`[e2e-rule-governance] executions items=${execItems}`);

    console.log(`[e2e-rule-governance] shots → ${SHOT_DIR}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[e2e-rule-governance] FAILED", err);
  process.exit(1);
});
