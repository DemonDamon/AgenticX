/**
 * Data Suite H5 self-serve query ACL e2e (Playwright)
 *
 * Asserts:
 * 1) outsider data role → HTTP 403 / 数据权限不足
 * 2) analyst → masked phone (not raw)
 * 3) data-security「自助取数试探」panel reachable
 * 4) same checks via in-page fetch (cookie session path)
 *
 * Sources enterprise/.env.local for admin password (H3 lesson).
 *
 * Run:
 *   set -a && source enterprise/.env.local && set +a
 *   pnpm -C enterprise exec tsx scripts/e2e-data-query-acl.ts
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

function loadEnvLocal(): void {
  const envPath = path.resolve(__dirname, "../.env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
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
}

loadEnvLocal();

const ADMIN_BASE = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3001";
const ADMIN_PASSWORD =
  process.env.ADMIN_CONSOLE_LOGIN_PASSWORD?.trim() ||
  process.env.AUTH_DEV_OWNER_PASSWORD?.trim() ||
  "ChangeMe_Dev14!Aa";
const SHOT_DIR =
  process.env.H5_E2E_SHOT_DIR ??
  path.resolve(__dirname, "../..", "docs/agx-data-suite/shots");

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

type QueryProbe = {
  status: number;
  code?: string;
  message?: string;
  phone?: string | null;
  masked?: boolean;
};

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

    const denied = await page.request.post(`${ADMIN_BASE}/api/admin/data-suite/query`, {
      data: { role: "outsider", dataset_id: "members", board_id: "sample_member_board" },
    });
    if (denied.status() !== 403) {
      throw new Error(`expected outsider 403, got ${denied.status()}`);
    }
    const deniedBody = (await denied.json()) as { code?: string; message?: string };
    if (deniedBody.code !== "40310" || deniedBody.message !== "数据权限不足") {
      throw new Error(`unexpected deny body: ${JSON.stringify(deniedBody)}`);
    }

    const allowed = await page.request.post(`${ADMIN_BASE}/api/admin/data-suite/query`, {
      data: { role: "analyst", dataset_id: "members", board_id: "sample_member_board" },
    });
    if (allowed.status() !== 200) {
      throw new Error(`expected analyst 200, got ${allowed.status()}`);
    }
    const allowedBody = (await allowed.json()) as {
      data?: { rows?: Array<{ phone?: string | null }>; masked?: boolean };
    };
    const phone = allowedBody.data?.rows?.[0]?.phone;
    if (allowedBody.data?.masked !== true) throw new Error("expected masked:true");
    if (phone !== "1*********8") {
      throw new Error(`expected analyst partial phone, got: ${phone}`);
    }

    await page.goto(`${ADMIN_BASE}/admin/data-security`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.getByTestId("data-security-page").waitFor({ state: "visible", timeout: 20_000 });
    await page.getByTestId("data-query-acl-panel").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("data-query-run").waitFor({ state: "visible", timeout: 5_000 });

    // In-page fetch with session cookies (portal/admin browser path)
    const inPageDenied = await page.evaluate(async (): Promise<QueryProbe> => {
      const res = await fetch("/api/admin/data-suite/query", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "outsider",
          dataset_id: "members",
          board_id: "sample_member_board",
        }),
      });
      const body = (await res.json()) as {
        code?: string;
        message?: string;
        data?: { rows?: Array<{ phone?: string | null }>; masked?: boolean };
      };
      return {
        status: res.status,
        code: body.code,
        message: body.message,
        phone: body.data?.rows?.[0]?.phone ?? null,
        masked: body.data?.masked,
      };
    });
    if (inPageDenied.status !== 403 || inPageDenied.code !== "40310") {
      throw new Error(`in-page deny failed: ${JSON.stringify(inPageDenied)}`);
    }

    const inPageAllowed = await page.evaluate(async (): Promise<QueryProbe> => {
      const res = await fetch("/api/admin/data-suite/query", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "analyst",
          dataset_id: "members",
          board_id: "sample_member_board",
        }),
      });
      const body = (await res.json()) as {
        code?: string;
        data?: { rows?: Array<{ phone?: string | null }>; masked?: boolean };
      };
      return {
        status: res.status,
        code: body.code,
        phone: body.data?.rows?.[0]?.phone ?? null,
        masked: body.data?.masked,
      };
    });
    if (inPageAllowed.status !== 200 || inPageAllowed.phone !== "1*********8") {
      throw new Error(`in-page allow/mask failed: ${JSON.stringify(inPageAllowed)}`);
    }

    await page.screenshot({
      path: path.join(SHOT_DIR, "h5-data-query-acl.png"),
      fullPage: true,
    });

    console.log("[e2e-data-query-acl] ok: API+in-page 403 + masked; panel visible");
    console.log(`[e2e-data-query-acl] shots: ${SHOT_DIR}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((e) => {
  console.error("[e2e-data-query-acl] failed:", e);
  process.exit(1);
});
