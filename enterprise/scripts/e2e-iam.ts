/**
 * IAM 端到端冒烟（Playwright）
 *
 * 前提：PostgreSQL 已迁移；`bash enterprise/scripts/start-dev.sh` 或手动起 web-portal:3000 + admin-console:3001
 *
 * 运行：
 *   pnpm -C enterprise e2e:iam
 *
 * 环境变量：
 *   ADMIN_BASE_URL（默认 http://127.0.0.1:3001）
 *   ADMIN_CONSOLE_LOGIN_PASSWORD / AUTH_DEV_OWNER_PASSWORD（与 db:seed 一致）
 */
import { chromium } from "playwright";

const ADMIN_BASE = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3001";
const ADMIN_PASSWORD =
  process.env.ADMIN_CONSOLE_LOGIN_PASSWORD?.trim() ||
  process.env.AUTH_DEV_OWNER_PASSWORD?.trim() ||
  "ChangeMe_Dev14!Aa";

async function adminLogin(page: import("playwright").Page): Promise<void> {
  await page.goto(`${ADMIN_BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const input = page.locator('input[type="password"]').first();
  await input.fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /登录并进入控制台/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await adminLogin(page);

    await page.goto(`${ADMIN_BASE}/iam/users`, { waitUntil: "domcontentloaded" });
    await page.getByText("用户管理").first().waitFor({ state: "visible", timeout: 15_000 });

    await page.goto(`${ADMIN_BASE}/iam/departments`, { waitUntil: "domcontentloaded" });
    await page.getByText("部门管理").first().waitFor({ state: "visible", timeout: 15_000 });

    await page.goto(`${ADMIN_BASE}/iam/roles`, { waitUntil: "domcontentloaded" });
    await page.getByText("角色与权限").first().waitFor({ state: "visible", timeout: 15_000 });

    await page.goto(`${ADMIN_BASE}/iam/bulk-import`, { waitUntil: "domcontentloaded" });
    await page.getByText("批量开通").first().waitFor({ state: "visible", timeout: 15_000 });

    console.log("[e2e-iam] ok: users, departments, roles, bulk-import pages visible after login");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("[e2e-iam] failed:", e);
  process.exitCode = 1;
});
