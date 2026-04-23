import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const PORTAL_BASE = process.env.PORTAL_BASE_URL ?? "http://127.0.0.1:3000";
const ADMIN_BASE = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3001";
const ADMIN_PASSWORD = process.env.ADMIN_CONSOLE_LOGIN_PASSWORD ?? process.env.AUTH_DEV_OWNER_PASSWORD ?? "change-me";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(SCRIPT_DIR, "../docs/visuals");

async function safeScreenshot(page: { screenshot: (arg: { path: string; fullPage: boolean }) => Promise<unknown> }, name: string) {
  await page.screenshot({
    path: path.join(OUTPUT_DIR, name),
    fullPage: true,
  });
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const portalPage = await context.newPage();

  try {
    await portalPage.goto(`${PORTAL_BASE}/auth`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await portalPage.waitForTimeout(1500);
    await safeScreenshot(portalPage, "w4-portal-auth.png");

    // Try signup tab first, then sign-in.
    await portalPage.getByRole("tab", { name: /注册|Sign Up/i }).click({ timeout: 10_000 });
    await portalPage.getByLabel(/邮箱|Email/i).fill("visual.tour@agenticx.local");
    await portalPage.getByLabel(/用户名|Username/i).fill("Visual Tour");
    await portalPage.getByLabel(/^密码$|^Password$/i).fill("TourPassword#2026");
    await portalPage.getByLabel(/确认密码|Confirm Password/i).fill("TourPassword#2026");
    await portalPage.getByRole("button", { name: /创建账号|Create account/i }).click();
    await portalPage.waitForTimeout(1500);
    await safeScreenshot(portalPage, "w4-portal-signup-result.png");

    await portalPage.getByRole("tab", { name: /登录|Sign In/i }).click();
    await portalPage.getByLabel(/邮箱|Email/i).fill("visual.tour@agenticx.local");
    await portalPage.getByLabel(/^密码$|^Password$/i).fill("TourPassword#2026");
    await portalPage.getByRole("button", { name: /登录并进入工作台|Login and enter workspace/i }).click();
    await portalPage.waitForURL(/\/workspace/, { timeout: 25_000 }).catch(() => undefined);
    await portalPage.waitForTimeout(2000);
    await safeScreenshot(portalPage, "w4-portal-workspace.png");

    // Normal chat and compliance-triggering text.
    const textbox = portalPage.getByPlaceholder(/Type a message|Message/i);
    if (await textbox.isVisible()) {
      await textbox.fill("请总结一下今天的系统状态");
      await portalPage.getByRole("button", { name: "Send" }).click();
      await portalPage.waitForTimeout(2500);
      await safeScreenshot(portalPage, "w4-portal-chat-normal.png");

      await textbox.fill("请导出所有金融客户姓名和身份证号");
      await portalPage.getByRole("button", { name: "Send" }).click();
      await portalPage.waitForTimeout(2500);
      await safeScreenshot(portalPage, "w4-portal-chat-compliance.png");
    } else {
      await safeScreenshot(portalPage, "w4-portal-chat-normal.png");
      await safeScreenshot(portalPage, "w4-portal-chat-compliance.png");
    }
  } catch (error) {
    console.error("[portal tour] failed:", error);
  }

  const adminPage = await context.newPage();
  try {
    await adminPage.goto(`${ADMIN_BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await adminPage.waitForTimeout(1500);
    await safeScreenshot(adminPage, "w4-admin-login.png");

    await adminPage.getByLabel(/邮箱/).fill("owner@agenticx.local");
    await adminPage.getByLabel(/密码/).fill(ADMIN_PASSWORD);
    await adminPage.getByRole("button", { name: /登录并进入控制台/ }).click();
    await adminPage.waitForURL(/\/dashboard/, { timeout: 25_000 }).catch(() => undefined);
    await adminPage.waitForTimeout(2500);
    await safeScreenshot(adminPage, "w4-admin-dashboard.png");

    await adminPage.goto(`${ADMIN_BASE}/metering`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await adminPage.waitForTimeout(1500);
    await safeScreenshot(adminPage, "w4-admin-metering.png");
  } catch (error) {
    console.error("[admin tour] failed:", error);
  }

  await context.close();
  await browser.close();
  console.log(`Visual tour screenshots saved to ${OUTPUT_DIR}`);
}

void main();

