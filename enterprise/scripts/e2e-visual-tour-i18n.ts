/**
 * i18n 视觉巡检：每个页面 × zh/en × dark/light
 * 输出：enterprise/docs/visuals/i18n/{page}-{locale}-{theme}.png
 *
 * 前提同 e2e-visual-tour.ts（start-dev.sh + visual-tour:install）
 * 运行：pnpm -C enterprise visual-tour:i18n
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
const OUTPUT_DIR = path.resolve(SCRIPT_DIR, "../docs/visuals/i18n");

type Theme = "dark" | "light";
type Locale = "zh" | "en";

async function setLocale(page: Page, locale: Locale): Promise<void> {
  await page.context().addCookies([
    {
      name: "NEXT_LOCALE",
      value: locale,
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  await page.evaluate((value) => {
    try {
      window.localStorage.setItem("agenticx-ui-locale", value);
    } catch {
      // noop
    }
    document.documentElement.lang = value === "en" ? "en" : "zh-CN";
  }, locale);
}

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

async function snapshot(page: Page, name: string, locale: Locale, theme: Theme): Promise<void> {
  await page.screenshot({
    path: path.join(OUTPUT_DIR, `${name}-${locale}-${theme}.png`),
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

async function loginAdmin(page: Page, locale: Locale): Promise<boolean> {
  await setLocale(page, locale);
  const ok = await safeGoto(page, `${ADMIN_BASE}/login`);
  if (!ok) return false;
  try {
    const emailLabel = locale === "en" ? /Email/i : /邮箱/;
    const pwdLabel = locale === "en" ? /^Password$/i : /^密码$/;
    const btn =
      locale === "en"
        ? /Login and enter|Sign in/i
        : /登录并进入控制台|登录并进入/;
    await page.getByLabel(emailLabel).fill("admin@agenticx.local", { timeout: 5_000 });
    await page.getByLabel(pwdLabel).fill(ADMIN_PASSWORD, { timeout: 5_000 });
    await page.getByRole("button", { name: btn }).click({ timeout: 5_000 });
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await page.waitForTimeout(2000);
    return true;
  } catch (error) {
    console.error("[admin login] failed:", (error as Error).message);
    return false;
  }
}

async function loginPortal(page: Page, locale: Locale): Promise<boolean> {
  await setLocale(page, locale);
  const ok = await safeGoto(page, `${PORTAL_BASE}/auth`);
  if (!ok) return false;
  try {
    await page.getByLabel(/邮箱|Email/i).fill("admin@agenticx.local", { timeout: 5_000 });
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

const ADMIN_PAGES: Array<{ name: string; path: string }> = [
  { name: "admin-dashboard", path: "/dashboard" },
  { name: "admin-iam-users", path: "/iam/users" },
  { name: "admin-iam-departments", path: "/iam/departments" },
  { name: "admin-iam-roles", path: "/iam/roles" },
  { name: "admin-iam-bulk-import", path: "/iam/bulk-import" },
  { name: "admin-audit", path: "/audit" },
  { name: "admin-metering", path: "/metering" },
  { name: "admin-metering-quota", path: "/metering/quota" },
  { name: "admin-policy", path: "/policy" },
  { name: "admin-models", path: "/admin/models" },
  { name: "admin-channels", path: "/admin/channels" },
  { name: "admin-cache", path: "/admin/cache" },
  { name: "admin-api-tokens", path: "/admin/api-tokens" },
  { name: "admin-mcp-servers", path: "/admin/mcp-servers" },
  { name: "admin-plugins", path: "/admin/plugins" },
  { name: "admin-errors", path: "/admin/errors" },
  { name: "admin-perf", path: "/admin/perf" },
];

async function tourAdmin(page: Page, locale: Locale, theme: Theme): Promise<void> {
  await setLocale(page, locale);
  await setTheme(page, theme);

  await safeGoto(page, `${ADMIN_BASE}/login`);
  await snapshot(page, "admin-login", locale, theme);

  const signedIn = await loginAdmin(page, locale);
  if (!signedIn) return;
  await setTheme(page, theme);

  for (const p of ADMIN_PAGES) {
    await safeGoto(page, `${ADMIN_BASE}${p.path}`);
    await setTheme(page, theme);
    await page.waitForTimeout(800);
    await snapshot(page, p.name, locale, theme);
  }
}

async function tourPortal(page: Page, locale: Locale, theme: Theme): Promise<void> {
  await setLocale(page, locale);
  await setTheme(page, theme);

  await safeGoto(page, `${PORTAL_BASE}/auth`);
  await snapshot(page, "portal-auth", locale, theme);

  const signedIn = await loginPortal(page, locale);
  if (!signedIn) return;
  await setTheme(page, theme);
  await snapshot(page, "portal-workspace", locale, theme);
}

async function probe(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal, redirect: "manual" });
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const [portalUp, adminUp] = await Promise.all([
    probe(`${PORTAL_BASE}/auth`),
    probe(`${ADMIN_BASE}/login`),
  ]);
  if (!portalUp || !adminUp) {
    console.error("✗ 请先运行: bash enterprise/scripts/start-dev.sh");
    process.exit(2);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  try {
    for (const locale of ["zh", "en"] as const) {
      for (const theme of ["dark", "light"] as const) {
        console.log(`\n=== locale=${locale} theme=${theme} ===`);
        const adminPage = await context.newPage();
        await tourAdmin(adminPage, locale, theme);
        await adminPage.close();

        const portalPage = await context.newPage();
        await tourPortal(portalPage, locale, theme);
        await portalPage.close();
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  console.log(`\ni18n visual tour saved to ${OUTPUT_DIR}`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
