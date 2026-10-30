/**
 * Rules & Knowledge P2 K3 — graph-incremental admin e2e (Playwright)
 *
 * Prerequisite: admin-console on :3001 with seeded admin user.
 *
 * Run (from repo root):
 *   set -a && source enterprise/.env.local && set +a
 *   pnpm -C enterprise exec tsx scripts/e2e-graph-incremental.ts
 *
 * Screenshots land in docs/agx-rules-knowledge-suite/e2e-shots/ (HD 1920x1080 @2x).
 * Shots 10/11/12 are element captures (list / detail / sync report) so MD5s differ.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ADMIN_BASE = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3001";
const ADMIN_EMAIL =
  process.env.ADMIN_CONSOLE_LOGIN_EMAIL?.trim() || "admin@agenticx.local";
const ADMIN_PASSWORD =
  process.env.ADMIN_CONSOLE_LOGIN_PASSWORD?.trim() ||
  process.env.AUTH_DEV_OWNER_PASSWORD?.trim() ||
  "ChangeMe_Dev14!Aa";
const SHOT_DIR =
  process.env.GRAPH_INCREMENTAL_E2E_SHOT_DIR ??
  path.resolve(__dirname, "../..", "docs/agx-rules-knowledge-suite/e2e-shots");

async function dismissNextOverlay(page: import("playwright").Page): Promise<void> {
  await page
    .evaluate(() => {
      document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
      const buttons = Array.from(document.querySelectorAll("button"));
      for (const b of buttons) {
        const t = (b.textContent || "").trim();
        if (/Close|Dismiss|×|关闭/.test(t)) b.click();
      }
    })
    .catch(() => undefined);
}

async function waitPastLoading(page: import("playwright").Page): Promise<void> {
  await page.getByTestId("graph-incremental-page").waitFor({ state: "visible", timeout: 30_000 });
  const loading = page.getByText(/加载图谱增量|Loading graph-incremental/i);
  try {
    await loading.waitFor({ state: "hidden", timeout: 20_000 });
  } catch {
    // may never have shown
  }
  await page.getByTestId("graph-incremental-list").waitFor({ state: "visible", timeout: 20_000 });
  await page.getByTestId("graph-incremental-table").waitFor({ state: "visible", timeout: 20_000 });
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
    page.getByRole("button", { name: /登录并进入控制台|Sign in to console/i }).click(),
  ]);
}

function md5File(file: string): string {
  const buf = fs.readFileSync(file);
  return crypto.createHash("md5").update(buf).digest("hex");
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

    await page.goto(`${ADMIN_BASE}/admin/graph-incremental`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await waitPastLoading(page);
    await dismissNextOverlay(page);

    // Ensure seed for stable cooling-loop rows
    const seedBtn = page.getByTestId("graph-incremental-seed");
    if (await seedBtn.isVisible().catch(() => false)) {
      await seedBtn.click();
      await page.waitForTimeout(1000);
      await waitPastLoading(page);
    }

    const rowCount = await page.locator('[data-testid="graph-incremental-table"] tbody tr').count();
    if (rowCount < 1) {
      throw new Error("graph-incremental source list has no rows");
    }
    console.log(`[e2e-graph-incremental] list rows=${rowCount}`);

    // Shot 10: list panel
    const list = page.getByTestId("graph-incremental-list");
    await list.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const shot10 = path.join(SHOT_DIR, "10-graph-incremental-list.png");
    await list.screenshot({ path: shot10 });

    const prefer = page.getByTestId("graph-incremental-row-src-ops-note-valve");
    if (await prefer.isVisible().catch(() => false)) {
      await prefer.click();
    } else {
      await page.locator('[data-testid="graph-incremental-table"] tbody tr').first().click();
    }

    await page.getByTestId("graph-incremental-detail").waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("graph-incremental-detail-id").waitFor({ state: "visible", timeout: 15_000 });

    // Run a mock sync so report panel has fresh content distinct from list
    const syncBtn = page.getByTestId("graph-incremental-sync");
    if (await syncBtn.isVisible().catch(() => false)) {
      await syncBtn.click();
      await page.waitForTimeout(1200);
    }

    const sourceText = await page.getByTestId("graph-incremental-source").innerText().catch(() => "");
    console.log(`[e2e-graph-incremental] source note: ${sourceText}`);

    // Shot 11: detail panel
    const detail = page.getByTestId("graph-incremental-detail");
    await detail.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const shot11 = path.join(SHOT_DIR, "11-graph-incremental-detail.png");
    await detail.screenshot({ path: shot11 });

    // Shot 12: sync report
    const report = page.getByTestId("graph-incremental-sync-report");
    await report.waitFor({ state: "visible", timeout: 15_000 });
    const reportId = page.getByTestId("graph-incremental-report-id");
    if (!(await reportId.isVisible().catch(() => false))) {
      throw new Error("sync report id not visible for shot 12");
    }
    await report.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const shot12 = path.join(SHOT_DIR, "12-graph-incremental-sync-report.png");
    await report.screenshot({ path: shot12 });

    const hashes = [shot10, shot11, shot12].map((f) => ({ file: path.basename(f), md5: md5File(f) }));
    const unique = new Set(hashes.map((h) => h.md5));
    if (unique.size !== 3) {
      throw new Error(`expected distinct MD5s for shots 10-12, got ${JSON.stringify(hashes)}`);
    }
    for (const h of hashes) {
      console.log(`[e2e-graph-incremental] ${h.file} md5=${h.md5}`);
    }
    console.log(`[e2e-graph-incremental] shots → ${SHOT_DIR}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[e2e-graph-incremental] FAILED", err);
  process.exit(1);
});
