/**
 * H9 + Harden UI verification with HD screenshots (1920×1080, deviceScaleFactor=2).
 *
 * Covers:
 *  - /admin/agent-schedules — Chinese「定时任务」
 *  - /admin/data-governance (H3)
 *  - /admin/data-query (H5 ACL) if present
 *  - /admin/data-jobs (H6)
 *  - /admin/data-idmapping (H7)
 *
 * Run from repo root:
 *   pnpm -C enterprise exec tsx scripts/e2e-h9-harden-shots.ts
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

function loadEnvLocal(): void {
  const candidates = [
    path.resolve(__dirname, "../.env.local"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "enterprise/.env.local"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
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
      if (!(key in process.env)) process.env[key] = val;
    }
    break;
  }
}

loadEnvLocal();

const ADMIN_BASE = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3001";
const ADMIN_EMAIL =
  process.env.ADMIN_CONSOLE_LOGIN_EMAIL?.trim() || "admin@agenticx.local";
const ADMIN_PASSWORD =
  process.env.ADMIN_CONSOLE_LOGIN_PASSWORD?.trim() ||
  process.env.AUTH_DEV_OWNER_PASSWORD?.trim() ||
  "ChangeMe_Dev14!Aa";
const SHOT_DIR =
  process.env.H9_E2E_SHOT_DIR ??
  path.resolve(__dirname, "../..", "docs/agx-data-suite/shots");

type CheckResult = {
  path: string;
  ok: boolean;
  shot?: string;
  note?: string;
  chineseHint?: string;
};

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
    page.waitForURL(/\/(dashboard|admin)/, { timeout: 45_000 }),
    page.getByRole("button", { name: /登录并进入控制台|Sign in to console/i }).click(),
  ]);
}

async function shotPage(
  page: import("playwright").Page,
  route: string,
  filename: string,
  assert?: (page: import("playwright").Page) => Promise<{ ok: boolean; note?: string; chineseHint?: string }>,
): Promise<CheckResult> {
  const out: CheckResult = { path: route, ok: false };
  try {
    await page.goto(`${ADMIN_BASE}${route}`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(800);
    const assertResult = assert
      ? await assert(page)
      : { ok: true, note: "loaded" };
    out.ok = assertResult.ok;
    out.note = assertResult.note;
    out.chineseHint = assertResult.chineseHint;
    const shotPath = path.join(SHOT_DIR, filename);
    await page.screenshot({ path: shotPath, fullPage: false });
    out.shot = shotPath;
  } catch (e) {
    out.ok = false;
    out.note = e instanceof Error ? e.message : String(e);
  }
  return out;
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
  });
  await context.addCookies([
    {
      name: "NEXT_LOCALE",
      value: "zh",
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  const page = await context.newPage();
  const results: CheckResult[] = [];

  try {
    await adminLogin(page);

    results.push(
      await shotPage(page, "/admin/agent-schedules", "h9-agent-schedules.png", async (p) => {
        const body = await p.locator("body").innerText();
        const hasTitle =
          body.includes("定时任务") ||
          (await p.getByText("定时任务").count()) > 0;
        const hasNav =
          (await p.getByRole("link", { name: /定时任务|Schedules/i }).count()) > 0 ||
          (await p.locator('a[href*="agent-schedules"]').count()) > 0;
        // page header / empty state
        const visibleChrome =
          hasTitle ||
          (await p.getByText(/新建定时任务|还没有定时任务|Schedules/i).count()) > 0;
        return {
          ok: hasTitle || visibleChrome,
          note: `title=${hasTitle} nav=${hasNav} chrome=${visibleChrome}`,
          chineseHint: hasTitle ? "定时任务" : undefined,
        };
      }),
    );

    results.push(
      await shotPage(page, "/admin/data-governance", "h3-data-governance-ops.png", async (p) => {
        const ok =
          (await p.getByTestId("data-governance-fields").count()) > 0 ||
          (await p.getByText(/数据治理|治理|字典/i).count()) > 0;
        return { ok, note: ok ? "governance visible" : "missing governance markers", chineseHint: "数据治理" };
      }),
    );

    // H5: try common paths
    const h5Candidates = ["/admin/data-query", "/admin/data-query-acl", "/admin/data-security"];
    let h5Done = false;
    for (const route of h5Candidates) {
      const r = await shotPage(page, route, "h5-data-query-acl.png", async (p) => {
        const body = await p.locator("body").innerText();
        const ok =
          body.includes("ACL") ||
          body.includes("脱敏") ||
          body.includes("权限") ||
          body.includes("查询") ||
          (await p.getByTestId("data-query-acl-page").count()) > 0 ||
          (await p.getByTestId("data-security-page").count()) > 0;
        return { ok, note: `route=${route}`, chineseHint: "数据查询/安全" };
      });
      if (r.ok) {
        results.push(r);
        h5Done = true;
        break;
      }
      // keep last attempt note if none ok
      if (route === h5Candidates[h5Candidates.length - 1]) results.push(r);
    }
    if (!h5Done) {
      // already pushed last
    }

    results.push(
      await shotPage(page, "/admin/data-jobs", "h6-data-jobs.png", async (p) => {
        const ok =
          (await p.getByTestId("data-jobs-page").count()) > 0 ||
          (await p.getByText(/数据作业|作业|Data jobs|Jobs/i).count()) > 0;
        return { ok, note: ok ? "jobs visible" : "missing jobs markers", chineseHint: "数据作业" };
      }),
    );

    results.push(
      await shotPage(page, "/admin/data-idmapping", "h7-data-idmapping.png", async (p) => {
        const ok =
          (await p.getByTestId("data-idmapping-page").count()) > 0 ||
          (await p.getByText(/ID.?Mapping|身份映射|ID 映射|ID映射/i).count()) > 0;
        return { ok, note: ok ? "idmapping visible" : "missing idmapping markers", chineseHint: "ID-Mapping" };
      }),
    );

    console.log("[e2e-h9-harden-shots] results:");
    for (const r of results) {
      console.log(
        JSON.stringify({
          path: r.path,
          ok: r.ok,
          shot: r.shot ? path.basename(r.shot) : null,
          note: r.note,
          chineseHint: r.chineseHint,
        }),
      );
    }
    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      console.error(`[e2e-h9-harden-shots] ${failed.length} check(s) failed`);
      process.exitCode = 1;
    } else {
      console.log("[e2e-h9-harden-shots] all checks ok");
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((e) => {
  console.error("[e2e-h9-harden-shots] failed:", e);
  process.exitCode = 1;
});
