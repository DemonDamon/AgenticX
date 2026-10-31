/**
 * W6 A4 UI gap closer: knowledge published → 查看邻域 → graph-explorer neighborhood.
 *
 *   pnpm -C enterprise exec tsx scripts/e2e-safe-query-a4-neighborhood.ts
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

async function adminLogin(page: import("playwright").Page): Promise<void> {
  await page.goto(`${ADMIN_BASE}/login`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.locator('input[type="email"]').first().fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(ADMIN_PASSWORD);
  await page.waitForTimeout(300);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 45_000 }),
    page.getByRole("button", { name: /登录并进入控制台|Sign in to console/i }).click(),
  ]);
}

async function shot(page: import("playwright").Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: true });
}

async function selectObject(page: import("playwright").Page, objectId: string): Promise<void> {
  await page.getByTestId(`knowledge-lifecycle-row-${objectId}`).click();
  await page.waitForFunction(
    (id) => {
      const el = document.querySelector('[data-testid="knowledge-lifecycle-detail-id"]');
      return el && el.textContent && el.textContent.includes(id);
    },
    objectId,
    { timeout: 15_000 },
  );
}

async function waitStatus(
  page: import("playwright").Page,
  re: RegExp,
  timeout = 15_000,
): Promise<string> {
  await page.waitForFunction(
    (pattern) => {
      const el = document.querySelector('[data-testid="knowledge-lifecycle-detail-status"]');
      return el && new RegExp(pattern, "i").test(el.textContent || "");
    },
    re.source,
    { timeout },
  );
  return page.getByTestId("knowledge-lifecycle-detail-status").innerText();
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  const result: Record<string, unknown> = {
    generated_at: new Date().toISOString(),
    admin_base: ADMIN_BASE,
    steps: {} as Record<string, unknown>,
  };
  const steps = result.steps as Record<string, unknown>;

  try {
    await adminLogin(page);

    // Seed Brand-A graph so neighborhood has Chinese entities.
    await page.goto(`${ADMIN_BASE}/admin/graph-explorer`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.getByTestId("graph-explorer-page").waitFor({ state: "visible", timeout: 20_000 });
    await page.getByTestId("graph-explorer-seed").click();
    await page.waitForTimeout(2000);
    await shot(page, "07a-graph-seed.png");
    steps.graph_seed_clicked = true;

    await page.goto(`${ADMIN_BASE}/admin/knowledge-lifecycle`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.getByTestId("knowledge-lifecycle-page").waitFor({ state: "visible", timeout: 20_000 });
    await page.getByTestId("knowledge-lifecycle-list").waitFor({ state: "visible", timeout: 20_000 });
    const sourceNote = await page.getByTestId("knowledge-lifecycle-source").innerText().catch(() => "");
    steps.source_note = sourceNote;

    // Publish draft device-pump-01 via UI transitions.
    await selectObject(page, "device-pump-01");
    let status = await page.getByTestId("knowledge-lifecycle-detail-status").innerText();
    steps.pump01_initial_status = status;
    if (/draft/i.test(status)) {
      await page.getByTestId("knowledge-lifecycle-transition-pending_review").click();
      status = await waitStatus(page, /pending_review/);
    }
    if (/pending_review/i.test(status)) {
      await page.getByTestId("knowledge-lifecycle-transition-published").click();
      status = await waitStatus(page, /published/);
    }
    steps.pump01_status = status;
    steps.pump01_published = /published/i.test(status);
    await page.getByTestId("knowledge-lifecycle-view-neighborhood").waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await shot(page, "07b-after-publish-pump01.png");

    // Open already-published site sample.
    await selectObject(page, "site-cooling-zone-1");
    const siteStatus = await waitStatus(page, /published/);
    steps.site_status = siteStatus;
    await page.getByTestId("knowledge-lifecycle-view-neighborhood").waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await shot(page, "07c-published-with-neighborhood-link.png");

    await page.getByTestId("knowledge-lifecycle-view-neighborhood").click();
    await page.waitForURL(/\/admin\/graph-explorer\?focus=site-cooling-zone-1/, { timeout: 20_000 });
    await page.getByTestId("graph-explorer-page").waitFor({ state: "visible", timeout: 20_000 });
    await page.getByTestId("graph-explorer-neighborhood").waitFor({ state: "visible", timeout: 20_000 });
    // Poll until Chinese entity names appear (seed + neighborhood fetch).
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="graph-explorer-neighborhood"]');
        const t = el?.textContent || "";
        return /一车间冷却区|1号循环泵|回路切断阀/.test(t);
      },
      undefined,
      { timeout: 30_000 },
    );
    const nbText = await page.getByTestId("graph-explorer-neighborhood").innerText();
    await shot(page, "07-neighborhood-ui.png");
    steps.landed_url = page.url();
    steps.neighborhood_text_snippet = nbText.replace(/\s+/g, " ").slice(0, 300);
    steps.neighborhood_has_chinese_entity = /一车间冷却区|1号循环泵|回路切断阀/.test(nbText);

    // Pump neighborhood after publish
    await page.goto(`${ADMIN_BASE}/admin/knowledge-lifecycle`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await selectObject(page, "device-pump-01");
    await page.getByTestId("knowledge-lifecycle-view-neighborhood").click();
    await page.waitForURL(/focus=device-pump-01/, { timeout: 20_000 });
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="graph-explorer-neighborhood"]');
        const t = el?.textContent || "";
        return /1号循环泵|一车间冷却区/.test(t);
      },
      undefined,
      { timeout: 30_000 },
    );
    const pumpNb = await page.getByTestId("graph-explorer-neighborhood").innerText();
    await shot(page, "08-neighborhood-pump01.png");
    steps.pump_neighborhood_snippet = pumpNb.replace(/\s+/g, " ").slice(0, 300);
    steps.pump_neighborhood_ok = /1号循环泵|一车间冷却区/.test(pumpNb);

    result.a4_ui_pass = Boolean(
      steps.pump01_published &&
        steps.neighborhood_has_chinese_entity &&
        steps.pump_neighborhood_ok &&
        String(steps.landed_url || "").includes("focus=site-cooling-zone-1"),
    );
  } finally {
    await browser.close();
  }

  const outPath = path.join(SHOT_DIR, "a4-neighborhood-ui-results.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  if (!result.a4_ui_pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
