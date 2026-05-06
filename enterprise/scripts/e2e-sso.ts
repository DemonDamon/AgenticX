#!/usr/bin/env tsx

import { chromium } from "playwright";

const PORTAL_BASE = process.env.PORTAL_BASE ?? "http://localhost:3000";
const ADMIN_BASE = process.env.ADMIN_BASE ?? "http://localhost:3001";

async function checkPage(url: string): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  console.log(`[e2e-sso] ok: ${url}`);
  await browser.close();
}

async function main() {
  // 轻量 smoke：确保页面可达且入口可见。
  await checkPage(`${PORTAL_BASE}/auth`);
  await checkPage(`${ADMIN_BASE}/login`);
  console.log("[e2e-sso] portal/admin auth pages reachable");
}

main().catch((error) => {
  console.error("[e2e-sso] failed:", error);
  process.exit(1);
});
