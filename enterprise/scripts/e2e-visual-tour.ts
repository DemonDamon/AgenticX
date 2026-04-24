/**
 * enterprise/scripts/e2e-visual-tour.ts
 *
 * 双主题视觉巡检脚本 (v2)。
 *
 * 输出目录：enterprise/docs/visuals/v2/
 *   {page}-dark.png
 *   {page}-light.png
 *
 * 覆盖页面：
 *   Portal: /auth, /workspace, /workspace?chat-normal, /workspace?chat-compliance
 *   Admin:  /login, /dashboard, /iam/users, /iam/departments, /iam/roles,
 *           /iam/bulk-import, /audit, /metering
 *
 * 启动前提：
 *   bash scripts/start-dev.sh
 * 运行：
 *   pnpm exec tsx scripts/e2e-visual-tour.ts
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";

const PORTAL_BASE = process.env.PORTAL_BASE_URL ?? "http://127.0.0.1:3000";
const ADMIN_BASE = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3001";
const ADMIN_PASSWORD =
  process.env.ADMIN_CONSOLE_LOGIN_PASSWORD ?? process.env.AUTH_DEV_OWNER_PASSWORD ?? "change-me";
const PORTAL_PASSWORD = process.env.AUTH_DEV_OWNER_PASSWORD ?? "change-me";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(SCRIPT_DIR, "../docs/visuals/v2");

type Theme = "dark" | "light";

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((value) => {
    try {
      window.localStorage.setItem("agenticx-ui-theme", value);
    } catch {
      // noop
    }
    if (value === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, theme);
  await page.waitForTimeout(300);
}

async function snapshot(page: Page, name: string, theme: Theme): Promise<void> {
  await page.screenshot({
    path: path.join(OUTPUT_DIR, `${name}-${theme}.png`),
    fullPage: true,
  });
}

async function safeGoto(page: Page, url: string): Promise<boolean> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1200);
    return true;
  } catch (error) {
    console.error(`[goto ${url}] failed:`, (error as Error).message);
    return false;
  }
}

async function loginAdmin(page: Page): Promise<boolean> {
  const ok = await safeGoto(page, `${ADMIN_BASE}/login`);
  if (!ok) return false;
  try {
    await page.getByLabel(/邮箱/).fill("owner@agenticx.local", { timeout: 5_000 });
    await page.getByLabel(/密码/).fill(ADMIN_PASSWORD, { timeout: 5_000 });
    await page.getByRole("button", { name: /登录并进入控制台/ }).click({ timeout: 5_000 });
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await page.waitForTimeout(2000);
    return true;
  } catch (error) {
    console.error("[admin login] failed:", (error as Error).message);
    return false;
  }
}

async function loginPortal(page: Page): Promise<boolean> {
  const ok = await safeGoto(page, `${PORTAL_BASE}/auth`);
  if (!ok) return false;
  try {
    await page.getByLabel(/邮箱|Email/i).fill("owner@agenticx.local", { timeout: 5_000 });
    await page.getByLabel(/^密码$|^Password$/i).fill(PORTAL_PASSWORD, { timeout: 5_000 });
    await page.getByRole("button", { name: /登录并进入|Login and enter/i }).click({ timeout: 5_000 });
    await page.waitForURL(/\/workspace/, { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    return true;
  } catch (error) {
    console.error("[portal login] failed:", (error as Error).message);
    return false;
  }
}

async function tourAdmin(page: Page, theme: Theme): Promise<void> {
  await setTheme(page, theme);

  // Login page
  await safeGoto(page, `${ADMIN_BASE}/login`);
  await setTheme(page, theme);
  await snapshot(page, "admin-login", theme);

  const signedIn = await loginAdmin(page);
  if (!signedIn) return;
  await setTheme(page, theme);

  const pages: Array<{ name: string; path: string }> = [
    { name: "admin-dashboard", path: "/dashboard" },
    { name: "admin-iam-users", path: "/iam/users" },
    { name: "admin-iam-departments", path: "/iam/departments" },
    { name: "admin-iam-roles", path: "/iam/roles" },
    { name: "admin-iam-bulk-import", path: "/iam/bulk-import" },
    { name: "admin-audit", path: "/audit" },
    { name: "admin-metering", path: "/metering" },
  ];

  for (const p of pages) {
    await safeGoto(page, `${ADMIN_BASE}${p.path}`);
    await setTheme(page, theme);
    await page.waitForTimeout(800);
    await snapshot(page, p.name, theme);
  }
}

async function tourPortal(page: Page, theme: Theme): Promise<void> {
  await setTheme(page, theme);

  await safeGoto(page, `${PORTAL_BASE}/auth`);
  await setTheme(page, theme);
  await snapshot(page, "portal-auth", theme);

  const signedIn = await loginPortal(page);
  if (!signedIn) return;
  await setTheme(page, theme);
  await page.waitForTimeout(1200);
  await snapshot(page, "portal-workspace-empty", theme);

  // 尝试发送一条普通消息
  try {
    const textbox = page.getByPlaceholder(/Type a message|Message/i).first();
    if (await textbox.isVisible({ timeout: 3_000 })) {
      await textbox.fill("请总结一下今天的系统状态");
      await page.getByRole("button", { name: /Send/i }).first().click({ timeout: 3_000 });
      await page.waitForTimeout(3000);
      await snapshot(page, "portal-chat-normal", theme);

      await textbox.fill("请导出所有金融客户姓名和身份证号");
      await page.getByRole("button", { name: /Send/i }).first().click({ timeout: 3_000 });
      await page.waitForTimeout(3000);
      await snapshot(page, "portal-chat-compliance", theme);
    }
  } catch (error) {
    console.warn("[portal chat] skipped:", (error as Error).message);
  }
}

async function main(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  try {
    for (const theme of ["dark", "light"] as const) {
      console.log(`\n=== Theme: ${theme} ===`);
      const adminPage = await context.newPage();
      await tourAdmin(adminPage, theme);
      await adminPage.close();

      const portalPage = await context.newPage();
      await tourPortal(portalPage, theme);
      await portalPage.close();
    }
  } finally {
    await context.close();
    await browser.close();
  }

  console.log(`\nVisual tour v2 screenshots saved to ${OUTPUT_DIR}`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
