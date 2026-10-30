/**
 * Data Suite H3 data-governance e2e (Playwright)
 *
 * Covers dictionary (S2) plus cleaning / classification / quality / review ops.
 *
 * Prerequisite: admin-console on :3001 with seeded admin user.
 *
 * Run:
 *   pnpm -C enterprise exec tsx scripts/e2e-data-governance.ts
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
  process.env.S2_E2E_SHOT_DIR ??
  path.resolve(__dirname, "../..", "docs/agx-data-suite/shots");
const DEMO_FIELD = "e2e_field_demo";
const DEMO_OWNER = "data-platform";
const DEMO_RULE = "e2e_clean_rule";
const DEMO_GRADE = "E2E";
const DEMO_METRIC = "e2e_null_rate";
const DEMO_REVIEW = "e2e_review_act";

async function adminLogin(page: import("playwright").Page): Promise<void> {
  await page.goto(`${ADMIN_BASE}/login`, { waitUntil: "networkidle", timeout: 60_000 });
  const email = page.locator('input[type="email"]').first();
  const password = page.locator('input[type="password"]').first();
  await email.waitFor({ state: "visible", timeout: 20_000 });
  await email.click();
  await email.fill("");
  await email.fill("admin@agenticx.local");
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
  let upserted = false;
  let opsOk = false;
  try {
    await adminLogin(page);
    await page.goto(`${ADMIN_BASE}/admin/data-governance`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.getByTestId("data-governance-page").waitFor({ state: "visible", timeout: 20_000 });
    await page.getByTestId("data-governance-tabs").waitFor({ state: "visible", timeout: 20_000 });
    await page.getByTestId("data-governance-fields").waitFor({ state: "visible", timeout: 20_000 });

    const stubVisible = await page.getByTestId("data-governance-stub").isVisible().catch(() => false);
    const rowCount = await page.locator('[data-testid="data-governance-fields"] tbody tr').count();
    if (rowCount < 1) {
      throw new Error("dictionary table has no field rows");
    }
    if (stubVisible) {
      console.warn("[e2e-data-governance] stub note visible (API may have failed); continuing with UI sample rows");
    }

    await page.screenshot({
      path: path.join(SHOT_DIR, "s2-data-governance-list.png"),
      fullPage: true,
    });

    const form = page.getByTestId("data-governance-upsert");
    if (await form.isVisible().catch(() => false)) {
      await page.getByTestId("data-governance-form-name").fill(DEMO_FIELD);
      await page.getByTestId("data-governance-form-owner").fill(DEMO_OWNER);
      await page.getByTestId("data-governance-form-update-freq").fill("daily");
      await page.getByTestId("data-governance-form-calc-logic").fill("e2e demo calc");
      await page.getByTestId("data-governance-form-business-def").fill("E2E demo dictionary field");
      await page.getByTestId("data-governance-form-save").click();

      await page
        .getByTestId(`data-governance-field-${DEMO_FIELD}`)
        .waitFor({ state: "visible", timeout: 20_000 });
      upserted = true;

      await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.getByTestId("data-governance-fields").waitFor({ state: "visible", timeout: 20_000 });
      await page
        .getByTestId(`data-governance-field-${DEMO_FIELD}`)
        .waitFor({ state: "visible", timeout: 20_000 });

      await page.screenshot({
        path: path.join(SHOT_DIR, "s2-data-governance-after-upsert.png"),
        fullPage: true,
      });
    } else {
      console.warn("[e2e-data-governance] upsert form not found; list shot only");
    }

    // --- H3 governance ops ---
    await page.getByTestId("data-governance-tab-cleaning").click();
    await page.getByTestId("data-governance-cleaning").waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("data-governance-cleaning-form-id").fill(DEMO_RULE);
    await page.getByTestId("data-governance-cleaning-form-template").fill("not_null");
    await page.getByTestId("data-governance-cleaning-form-field").fill("id");
    await page.getByTestId("data-governance-cleaning-form-enabled").fill("true");
    await page.getByTestId("data-governance-cleaning-form-save").click();
    await page
      .getByTestId(`data-governance-cleaning-rule-${DEMO_RULE}`)
      .waitFor({ state: "visible", timeout: 20_000 });

    await page.getByTestId("data-governance-tab-classification").click();
    await page.getByTestId("data-governance-classification").waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("data-governance-grade-form-id").fill(DEMO_GRADE);
    await page.getByTestId("data-governance-grade-form-label").fill("E2E grade");
    await page.getByTestId("data-governance-grade-form-rank").fill("0");
    await page.getByTestId("data-governance-grade-form-save").click();
    await page
      .getByTestId(`data-governance-grade-${DEMO_GRADE}`)
      .waitFor({ state: "visible", timeout: 20_000 });

    await page.getByTestId("data-governance-tab-quality").click();
    await page.getByTestId("data-governance-quality").waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("data-governance-quality-form-id").fill(DEMO_METRIC);
    await page.getByTestId("data-governance-quality-form-type").fill("null_rate");
    await page.getByTestId("data-governance-quality-form-field").fill("id");
    await page.getByTestId("data-governance-quality-form-save").click();
    await page
      .getByTestId(`data-governance-quality-metric-${DEMO_METRIC}`)
      .waitFor({ state: "visible", timeout: 20_000 });
    await page.getByTestId("data-governance-quality-run").click();
    await page.getByTestId("data-governance-quality-last-run").waitFor({ state: "visible", timeout: 20_000 });

    await page.getByTestId("data-governance-tab-review").click();
    await page.getByTestId("data-governance-review").waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("data-governance-review-form-id").fill(DEMO_REVIEW);
    await page.getByTestId("data-governance-review-form-target").fill(DEMO_RULE);
    await page.getByTestId("data-governance-review-form-decision").fill("approve");
    await page.getByTestId("data-governance-review-form-note").fill("e2e approve");
    await page.getByTestId("data-governance-review-form-save").click();
    await page
      .getByTestId(`data-governance-review-action-${DEMO_REVIEW}`)
      .waitFor({ state: "visible", timeout: 20_000 });

    await page.screenshot({
      path: path.join(SHOT_DIR, "h3-data-governance-ops.png"),
      fullPage: true,
    });
    opsOk = true;

    console.log(
      `[e2e-data-governance] ok: list rows=${rowCount} stub=${stubVisible} upserted=${upserted} ops=${opsOk}`,
    );
    console.log(`[e2e-data-governance] shots: ${SHOT_DIR}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((e) => {
  console.error("[e2e-data-governance] failed:", e);
  process.exitCode = 1;
});
