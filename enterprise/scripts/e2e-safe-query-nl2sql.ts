/**
 * W6 copper-pipe: safe-query NL2SQL + knowledge neighborhood click verification.
 *
 * Prerequisite: admin-console on :3001 (W4 UI with /admin/data-nl2sql).
 *
 * Run (from repo root):
 *   set -a && source enterprise/.env.local && set +a
 *   pnpm -C enterprise exec tsx scripts/e2e-safe-query-nl2sql.ts
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

function loadEnterpriseEnvLocal(): void {
  const candidates = [
    path.resolve(__dirname, "../.env.local"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "enterprise/.env.local"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, "utf8");
    for (const line of raw.split("\n")) {
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
      if (process.env[key] === undefined) process.env[key] = val;
    }
    break;
  }
}

loadEnterpriseEnvLocal();

const ADMIN_BASE = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3001";
const ADMIN_EMAIL =
  process.env.ADMIN_CONSOLE_LOGIN_EMAIL?.trim() || "admin@agenticx.local";
const ADMIN_PASSWORD =
  process.env.ADMIN_CONSOLE_LOGIN_PASSWORD?.trim() ||
  process.env.AUTH_DEV_OWNER_PASSWORD?.trim() ||
  "ChangeMe_Dev14!Aa";
const SHOT_DIR =
  process.env.SAFE_QUERY_E2E_SHOT_DIR ??
  path.resolve(__dirname, "../..", "docs/agx-data-suite/shots/safe-query-e2e");

type StepResult = { id: string; ok: boolean; detail: string };

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
  try {
    await Promise.all([
      page.waitForURL(/\/dashboard/, { timeout: 45_000 }),
      page.getByRole("button", { name: /登录并进入控制台|Sign in to console/i }).click(),
    ]);
  } catch (err) {
    const url = page.url();
    const errText = await page
      .getByText(/登录失败|Login failed|检查邮箱和密码|Invalid/i)
      .first()
      .innerText()
      .catch(() => "");
    throw new Error(
      `admin login did not reach /dashboard (url=${url} hint=${errText || "none"}). ` +
        `Original: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function shot(page: import("playwright").Page, name: string): Promise<string> {
  const file = path.join(SHOT_DIR, name);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const results: StepResult[] = [];
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  try {
    await adminLogin(page);
    await shot(page, "00-dashboard-after-login.png");

    await page.goto(`${ADMIN_BASE}/admin/data-nl2sql`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.getByTestId("data-nl2sql-page").waitFor({ state: "visible", timeout: 20_000 });
    await shot(page, "01-data-nl2sql-page.png");

    // A2: explain
    await page.getByTestId("data-nl2sql-mode-explain").click();
    await page.getByTestId("data-nl2sql-run").click();
    await page.getByTestId("data-nl2sql-result").waitFor({ state: "visible", timeout: 20_000 });
    await page.getByTestId("data-nl2sql-sql").waitFor({ state: "visible", timeout: 10_000 });
    const sqlText = await page.getByTestId("data-nl2sql-sql").innerText();
    const explainNote = await page.getByTestId("data-nl2sql-explain-note").isVisible();
    const rowsAfterExplain = await page.getByTestId("data-nl2sql-rows").count();
    const a2ok =
      /SELECT/i.test(sqlText) && explainNote && rowsAfterExplain === 0;
    results.push({
      id: "A2-explain",
      ok: a2ok,
      detail: `sqlHasSelect=${/SELECT/i.test(sqlText)} explainNote=${explainNote} rowsCount=${rowsAfterExplain}`,
    });
    await shot(page, "02-explain-mode.png");

    // A3: execute
    await page.getByTestId("data-nl2sql-mode-execute").click();
    await page.getByTestId("data-nl2sql-run").click();
    await page.getByTestId("data-nl2sql-rows").waitFor({ state: "visible", timeout: 20_000 });
    const rowsText = await page.getByTestId("data-nl2sql-rows").innerText();
    const a3ok = /华东/.test(rowsText);
    results.push({
      id: "A3-execute",
      ok: a3ok,
      detail: `rowsSnippet=${rowsText.replace(/\s+/g, " ").slice(0, 120)}`,
    });
    await shot(page, "03-execute-rows.png");

    // A1: write-gate denial
    await page.getByTestId("data-nl2sql-demo-deny").click();
    await page.getByTestId("data-nl2sql-run").click();
    await page.getByTestId("data-nl2sql-denial").waitFor({ state: "visible", timeout: 20_000 });
    const denyReason = await page.getByTestId("data-nl2sql-denial-reason").innerText();
    const a1ok = /写闸已拒绝/.test(denyReason);
    results.push({
      id: "A1-write-gate",
      ok: a1ok,
      detail: `denial=${denyReason}`,
    });
    await shot(page, "04-write-gate-denial.png");

    // A4: knowledge lifecycle + optional neighborhood link
    await page.goto(`${ADMIN_BASE}/admin/knowledge-lifecycle`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.getByTestId("knowledge-lifecycle-page").waitFor({ state: "visible", timeout: 20_000 });
    await shot(page, "05-knowledge-lifecycle.png");
    const nbCount = await page.getByTestId("knowledge-lifecycle-view-neighborhood").count();
    if (nbCount > 0) {
      await page.getByTestId("knowledge-lifecycle-view-neighborhood").first().click();
      await page.waitForURL(/\/admin\/graph-explorer\?focus=/, { timeout: 20_000 });
      await page.getByTestId("graph-explorer-page").waitFor({ state: "visible", timeout: 20_000 });
      await shot(page, "06-graph-explorer-neighborhood.png");
      results.push({
        id: "A4-neighborhood-ui",
        ok: true,
        detail: "clicked view-neighborhood → graph-explorer",
      });
    } else {
      const listOk = await page.getByTestId("knowledge-lifecycle-list").isVisible();
      results.push({
        id: "A4-neighborhood-ui",
        ok: listOk,
        detail:
          "no published object with view-neighborhood in seed; page+list visible — API A4 covered by W5 pytest",
      });
      await shot(page, "06-knowledge-lifecycle-no-published.png");
    }
  } finally {
    await browser.close();
  }

  const out = {
    generated_at: new Date().toISOString(),
    admin_base: ADMIN_BASE,
    results,
    all_click_steps_ok: results.every((r) => r.ok),
  };
  const jsonPath = path.join(SHOT_DIR, "playwright-click-results.json");
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  if (!out.all_click_steps_ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
