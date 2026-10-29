/**
 * Rules & Knowledge P1 K2 — knowledge-lifecycle admin e2e (Playwright)
 *
 * Prerequisite: admin-console on :3001 with seeded admin user.
 *
 * Run (from repo root):
 *   set -a && source enterprise/.env.local && set +a
 *   pnpm -C enterprise exec tsx scripts/e2e-knowledge-lifecycle.ts
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
  process.env.KNOWLEDGE_E2E_SHOT_DIR ??
  path.resolve(__dirname, "../..", "docs/agx-rules-knowledge-suite/e2e-shots");

async function waitPastLoading(page: import("playwright").Page): Promise<void> {
  await page.getByTestId("knowledge-lifecycle-page").waitFor({ state: "visible", timeout: 30_000 });
  const loading = page.getByText(/加载知识对象|Loading knowledge/i);
  try {
    await loading.waitFor({ state: "hidden", timeout: 20_000 });
  } catch {
    // may never have shown
  }
  await page.getByTestId("knowledge-lifecycle-list").waitFor({ state: "visible", timeout: 20_000 });
  await page.getByTestId("knowledge-lifecycle-table").waitFor({ state: "visible", timeout: 20_000 });
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

    await page.goto(`${ADMIN_BASE}/admin/knowledge-lifecycle`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await waitPastLoading(page);

    const rowCount = await page.locator('[data-testid="knowledge-lifecycle-table"] tbody tr').count();
    if (rowCount < 1) {
      throw new Error("knowledge object list has no rows");
    }
    console.log(`[e2e-knowledge-lifecycle] list rows=${rowCount}`);

    const prefer = page.getByTestId("knowledge-lifecycle-row-brand-a-entity-pump-02");
    if (await prefer.isVisible().catch(() => false)) {
      await prefer.click();
    } else {
      await page.locator('[data-testid="knowledge-lifecycle-table"] tbody tr').first().click();
    }

    await page.getByTestId("knowledge-lifecycle-detail").waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("knowledge-lifecycle-detail-id").waitFor({ state: "visible", timeout: 15_000 });

    // Run quality to populate issues for shot
    const qualityBtn = page.getByTestId("knowledge-lifecycle-run-quality");
    if (await qualityBtn.isVisible().catch(() => false)) {
      await qualityBtn.click();
      await page.waitForTimeout(1200);
      await prefer.click().catch(() => undefined);
      await page.waitForTimeout(500);
    }

    const sourceText = await page.getByTestId("knowledge-lifecycle-source").innerText().catch(() => "");
    console.log(`[e2e-knowledge-lifecycle] source note: ${sourceText}`);

    await page.screenshot({
      path: path.join(SHOT_DIR, "04-knowledge-lifecycle-list.png"),
      fullPage: true,
    });

    await page.getByTestId("knowledge-lifecycle-detail").scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.screenshot({
      path: path.join(SHOT_DIR, "05-knowledge-lifecycle-detail.png"),
      fullPage: true,
    });

    const issues = page.getByTestId("knowledge-lifecycle-issues");
    if (await issues.isVisible().catch(() => false)) {
      await issues.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(SHOT_DIR, "06-knowledge-lifecycle-issues.png"),
        fullPage: true,
      });
      console.log("[e2e-knowledge-lifecycle] issues panel visible");
    } else {
      console.warn("[e2e-knowledge-lifecycle] no issues panel yet; list+detail shots still taken");
      await page.screenshot({
        path: path.join(SHOT_DIR, "06-knowledge-lifecycle-issues.png"),
        fullPage: true,
      });
    }

    console.log(`[e2e-knowledge-lifecycle] shots → ${SHOT_DIR}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[e2e-knowledge-lifecycle] FAILED", err);
  process.exit(1);
});
