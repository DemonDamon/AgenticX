/**
 * Rules & Knowledge P2 K3 — graph-explorer admin e2e (Playwright)
 *
 * Prerequisite: admin-console on :3001 with seeded admin user.
 *
 * Run (from repo root):
 *   set -a && source enterprise/.env.local && set +a
 *   # optional local without Neo4j:
 *   export AGX_GRAPH_STORE_BACKEND=file
 *   # production-ish with Neo4j:
 *   # export NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=...
 *   pnpm -C enterprise exec tsx scripts/e2e-graph-explorer.ts
 *
 * Screenshots land in docs/agx-rules-knowledge-suite/e2e-shots/ (HD 1920x1080 @2x).
 * Shots 17/18/19 are element captures (canvas / node detail / backend badge).
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
  process.env.GRAPH_EXPLORER_E2E_SHOT_DIR ??
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
  await page.getByTestId("graph-explorer-page").waitFor({ state: "visible", timeout: 30_000 });
  const loading = page.getByText(/Loading graph from GraphStore|正在从 GraphStore/i);
  try {
    await loading.waitFor({ state: "hidden", timeout: 20_000 });
  } catch {
    // may never have shown
  }
  await page.getByTestId("graph-explorer-backend").waitFor({ state: "visible", timeout: 20_000 });
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

    await page.goto(`${ADMIN_BASE}/admin/graph-explorer`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await waitPastLoading(page);
    await dismissNextOverlay(page);

    const seedBtn = page.getByTestId("graph-explorer-seed");
    if (await seedBtn.isVisible().catch(() => false)) {
      await seedBtn.click();
      await page.waitForTimeout(1200);
      await waitPastLoading(page);
    }

    await page.getByTestId("graph-explorer-canvas").waitFor({ state: "visible", timeout: 30_000 });
    const backendVal = (
      await page.getByTestId("graph-explorer-backend-value").innerText()
    ).trim();
    if (!backendVal || backendVal === "—") {
      throw new Error(`graph-explorer backend badge empty: ${backendVal}`);
    }
    console.log(`[e2e-graph-explorer] backend=${backendVal}`);

    // Shot 17: canvas
    const canvasCard = page.getByTestId("graph-explorer-canvas-card");
    await canvasCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const shot17 = path.join(SHOT_DIR, "17-graph-explorer-canvas.png");
    await canvasCard.screenshot({ path: shot17 });

    // Click pump node (SVG <g> — use force click on circle)
    const pump = page.getByTestId("graph-explorer-node-device-pump-01");
    await pump.waitFor({ state: "visible", timeout: 15_000 });
    await pump.locator("circle").click({ force: true });
    await page.waitForTimeout(800);
    await page.getByTestId("graph-explorer-detail-id").waitFor({ state: "visible", timeout: 15_000 });
    const detailText = await page.getByTestId("graph-explorer-detail").innerText();
    if (!/device-pump-01/i.test(detailText)) {
      throw new Error(`node detail missing pump id: ${detailText.slice(0, 200)}`);
    }

    // Shot 18: detail panel
    const detail = page.getByTestId("graph-explorer-detail");
    await detail.scrollIntoViewIfNeeded();
    const shot18 = path.join(SHOT_DIR, "18-graph-explorer-node-detail.png");
    await detail.screenshot({ path: shot18 });

    // Shot 19: backend badge strip
    const badge = page.getByTestId("graph-explorer-backend");
    await badge.scrollIntoViewIfNeeded();
    const shot19 = path.join(SHOT_DIR, "19-graph-explorer-backend-badge.png");
    await badge.screenshot({ path: shot19 });

    // Closed loop: force-change a source via incremental sync API cookie session,
    // then reload explorer and confirm GraphStore node attrs reflect the publish.
    await page.goto(`${ADMIN_BASE}/admin/graph-incremental`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.getByTestId("graph-incremental-page").waitFor({ state: "visible", timeout: 30_000 });
    await dismissNextOverlay(page);
    const storeBackendLine = page.getByTestId("graph-incremental-store-backend");
    await storeBackendLine.waitFor({ state: "visible", timeout: 20_000 });
    // Ensure GraphStore seed so live stats / report graph_stats are populated.
    const incrSeed = page.getByTestId("graph-incremental-seed");
    if (await incrSeed.isVisible().catch(() => false)) {
      await incrSeed.click();
      await page.waitForTimeout(1500);
      await page.getByTestId("graph-incremental-refresh").click().catch(() => undefined);
      await page.waitForTimeout(800);
    }
    const backendValue = page.getByTestId("graph-incremental-store-backend-value");
    await backendValue.waitFor({ state: "visible", timeout: 30_000 });
    // Poll until GraphStore backend resolves (Neo4j bridge can take a few seconds).
    let storeBackendText = "";
    for (let i = 0; i < 20; i++) {
      storeBackendText = (await backendValue.innerText()).trim();
      if (/^(file|memory|neo4j)$/i.test(storeBackendText)) break;
      await page.waitForTimeout(500);
      if (i === 5 || i === 12) {
        await page.getByTestId("graph-incremental-refresh").click().catch(() => undefined);
      }
    }
    if (!/^(file|memory|neo4j)$/i.test(storeBackendText)) {
      throw new Error(`graph-incremental missing real store_backend: ${storeBackendText}`);
    }
    console.log(`[e2e-graph-explorer] incremental ${storeBackendText}`);

    const syncResp = await page.request.post(`${ADMIN_BASE}/api/admin/graph-incremental/sync`, {
      data: {
        force_changed_ids: ["src-ops-note-valve"],
        actor: "e2e-graph-explorer",
      },
    });
    if (!syncResp.ok()) {
      throw new Error(`incremental sync failed: ${syncResp.status()} ${await syncResp.text()}`);
    }
    const syncJson = (await syncResp.json()) as {
      data?: {
        report?: {
          run_id?: string;
          published_object_ids?: string[];
          graph_stats?: Record<string, unknown>;
        };
      };
    };
    const report = (syncJson.data?.report || {}) as {
      run_id?: string;
      published_object_ids?: string[];
      graph_stats?: Record<string, unknown>;
    };
    const runId = String(report.run_id || "");
    if (!runId) throw new Error(`sync missing run_id: ${JSON.stringify(syncJson).slice(0, 300)}`);
    console.log(
      `[e2e-graph-explorer] synced run=${runId} published=${JSON.stringify(report.published_object_ids)} backend=${report.graph_stats?.store_backend}`,
    );

    await page.goto(`${ADMIN_BASE}/admin/graph-explorer`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await waitPastLoading(page);
    await dismissNextOverlay(page);
    const valve = page.getByTestId("graph-explorer-node-device-valve-01");
    await valve.waitFor({ state: "visible", timeout: 15_000 });
    await valve.locator("circle").click({ force: true });
    await page.waitForTimeout(800);
    const detailAfter = await page.getByTestId("graph-explorer-detail").innerText();
    if (!runId || !detailAfter.includes(runId)) {
      // attrs panel may stringify JSON — require last_sync_run_id evidence
      if (!/last_sync_run_id/i.test(detailAfter) || !detailAfter.includes(runId)) {
        throw new Error(
          `explorer did not reflect incremental publish run ${runId}: ${detailAfter.slice(0, 500)}`,
        );
      }
    }
    console.log("[e2e-graph-explorer] closed-loop: explorer shows last_sync_run_id after sync");

    const hashes = [shot17, shot18, shot19].map((f) => ({ f: path.basename(f), md5: md5File(f) }));
    console.log("[e2e-graph-explorer] shots", hashes);
    const uniq = new Set(hashes.map((h) => h.md5));
    if (uniq.size !== hashes.length) {
      throw new Error(`shot MD5s not distinct: ${JSON.stringify(hashes)}`);
    }
    console.log("[e2e-graph-explorer] OK");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
