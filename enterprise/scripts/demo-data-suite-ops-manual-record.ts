/**
 * Record Data Suite admin product demo as MP4 with Chinese VO + burned captions.
 * Investor/human-readable narrative (口语旁白) + documentary camera (zoom local → global).
 * Forked from demo-rk-ops-manual-record.ts — do NOT break the RK recorder.
 *
 * Run (from repo root):
 *   set -a && source enterprise/.env.local && set +a
 *   DEMO_TTS_CACHE_DIR="$(pwd)/.runtime/agx-data-suite-demo-tts" \
 *     pnpm -C enterprise exec tsx scripts/demo-data-suite-ops-manual-record.ts
 */
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, execSync } from "node:child_process";

const ADMIN_BASE = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3001";
const ADMIN_EMAIL =
  process.env.ADMIN_CONSOLE_LOGIN_EMAIL?.trim() || "admin@agenticx.local";
const ADMIN_PASSWORD =
  process.env.ADMIN_CONSOLE_LOGIN_PASSWORD?.trim() ||
  process.env.AUTH_DEV_OWNER_PASSWORD?.trim() ||
  "ChangeMe_Dev14!Aa";

const OUT_MP4 = path.resolve(
  __dirname,
  "../..",
  "docs/agx-data-suite/shots/data-suite-ops-manual-demo.mp4",
);

const VW = Number(process.env.DEMO_VIEWPORT_W || "1600");
const VH = Number(process.env.DEMO_VIEWPORT_H || "1000");
const DEVICE_SCALE = Number(process.env.DEMO_DEVICE_SCALE || "1");

const TTS_CACHE_DIR =
  process.env.DEMO_TTS_CACHE_DIR?.trim() ||
  path.resolve(__dirname, "../../.runtime/agx-data-suite-demo-tts");
const TTS_VOICE =
  process.env.DEMO_TTS_VOICE?.trim() || "zh-CN-XiaoxiaoNeural";
const TTS_RATE = process.env.DEMO_TTS_RATE?.trim() || "+8%";
const SAY_RATE = Number(process.env.DEMO_SAY_RATE || "180");
const CLAUSE_GAP_MS = Number(process.env.DEMO_CLAUSE_GAP_MS || "180");
const ALLOW_SAY = process.env.DEMO_TTS_ALLOW_SAY === "1";

const failures: string[] = [];
const visited: string[] = [];

type Cue = {
  id: string;
  vo: string;
  caption?: string;
  holdAfterMs?: number;
  focus?: string;
  focusScale?: number;
  run: (page: Page) => Promise<void>;
};

type TimelineEntry = {
  id: string;
  vo: string;
  caption: string;
  startSec: number;
  endSec: number;
  wav: string;
};

async function pause(page: Page, ms = 1500): Promise<void> {
  await page.waitForTimeout(ms);
}

async function dismissNextOverlay(page: Page): Promise<void> {
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

async function safeStep(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    visited.push(`OK ${label}`);
    console.log(`[demo] OK ${label}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${label}: ${msg}`);
    visited.push(`FAIL ${label}`);
    console.error(`[demo] FAIL ${label}: ${msg}`);
  }
}

async function zoomTo(
  page: Page,
  selector: string,
  opts?: { scale?: number; durationMs?: number; padding?: number },
): Promise<void> {
  const scale = opts?.scale ?? 1.85;
  const durationMs = opts?.durationMs ?? 850;
  const padding = opts?.padding ?? 56;
  const loc = page.locator(selector).first();
  const visible = await loc.isVisible().catch(() => false);
  if (!visible) {
    console.warn(`[demo] zoomTo miss: ${selector}`);
    return;
  }
  await loc.scrollIntoViewIfNeeded().catch(() => undefined);
  await page
    .evaluate(
      ({ sel, padding }) => {
        const el = document.querySelector(sel);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const targetY = window.innerHeight * 0.32;
        const delta = r.top - targetY;
        if (Math.abs(delta) > 24) {
          window.scrollBy({ top: delta - padding * 0.2, behavior: "auto" });
        }
      },
      { sel: selector, padding },
    )
    .catch(() => undefined);
  await page.waitForTimeout(180);
  await page.evaluate(
    ({ sel, scale, durationMs }) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const ox = r.left + r.width / 2;
      const oy = r.top + Math.min(r.height * 0.35, 80);
      const html = document.documentElement as HTMLElement;
      html.style.transition = `transform ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      html.style.transformOrigin = `${ox}px ${oy}px`;
      html.style.transform = `scale(${scale})`;
      let ring = document.getElementById("demo-zoom-ring");
      if (!ring) {
        ring = document.createElement("div");
        ring.id = "demo-zoom-ring";
        document.body.appendChild(ring);
      }
      const rr = el.getBoundingClientRect();
      Object.assign(ring.style, {
        position: "fixed",
        left: `${rr.left - 8}px`,
        top: `${rr.top - 8}px`,
        width: `${rr.width + 16}px`,
        height: `${rr.height + 16}px`,
        border: "2px solid rgba(96,165,250,0.95)",
        borderRadius: "10px",
        boxShadow:
          "0 0 0 9999px rgba(15,23,42,0.28), 0 0 24px rgba(59,130,246,0.45)",
        pointerEvents: "none",
        zIndex: "2147483646",
        transition: `opacity ${Math.min(400, durationMs)}ms ease`,
        opacity: "1",
      } as CSSStyleDeclaration);
    },
    { sel: selector, scale, durationMs },
  );
  await page.waitForTimeout(durationMs + 60);
}

async function zoomOut(
  page: Page,
  opts?: { durationMs?: number },
): Promise<void> {
  const durationMs = opts?.durationMs ?? 700;
  await page
    .evaluate((durationMs) => {
      const html = document.documentElement as HTMLElement;
      html.style.transition = `transform ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      html.style.transform = "scale(1)";
      const ring = document.getElementById("demo-zoom-ring");
      if (ring) {
        ring.style.opacity = "0";
        setTimeout(() => ring.remove(), durationMs + 40);
      }
    }, durationMs)
    .catch(() => undefined);
  await page.waitForTimeout(durationMs + 60);
}

async function adminLogin(page: Page): Promise<void> {
  const api = await page.request.post(`${ADMIN_BASE}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (api.ok()) {
    await page.goto(`${ADMIN_BASE}/dashboard`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    if (!page.url().includes("/login")) {
      await dismissNextOverlay(page);
      return;
    }
  }
  await page.goto(`${ADMIN_BASE}/login`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
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
    page
      .getByRole("button", { name: /登录并进入控制台|Sign in to console/i })
      .click({ force: true }),
  ]);
  await dismissNextOverlay(page);
}

function splitClauses(text: string): string[] {
  const parts = text
    .split(/(?<=[。！？…；])/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [text];
}

function wavDuration(wav: string): number {
  return Number(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=nokey=1:noprint_wrappers=1",
        wav,
      ],
      { encoding: "utf8" },
    ).trim(),
  );
}

function sayClauseToWav(text: string, outWav: string, workDir: string): void {
  if (!ALLOW_SAY) {
    throw new Error(
      `macOS say blocked (set DEMO_TTS_ALLOW_SAY=1 only as last resort). Missing neural wav for: ${text.slice(0, 40)}`,
    );
  }
  const aiff = path.join(workDir, `${path.basename(outWav, ".wav")}.aiff`);
  const sayVoice =
    process.env.DEMO_SAY_VOICE?.trim() || "Shelley (中文（中国大陆）)";
  execFileSync(
    "say",
    ["-v", sayVoice, "-r", String(SAY_RATE), "-o", aiff, text],
    { stdio: "pipe" },
  );
  execFileSync(
    "ffmpeg",
    ["-y", "-i", aiff, "-ar", "44100", "-ac", "1", outWav],
    { stdio: "pipe" },
  );
  try {
    fs.unlinkSync(aiff);
  } catch {
    /* ignore */
  }
}

function sayToWav(
  text: string,
  outWav: string,
  workDir: string,
  cueId?: string,
): number {
  if (cueId) {
    const cached = path.join(TTS_CACHE_DIR, `${cueId}.wav`);
    if (fs.existsSync(cached)) {
      fs.copyFileSync(cached, outWav);
      return wavDuration(outWav);
    }
    if (!ALLOW_SAY) {
      throw new Error(
        `missing neural TTS cache: ${cached} (generate with edge-tts / set DEMO_TTS_CACHE_DIR)`,
      );
    }
    console.warn(`[demo] cache miss ${cueId}, falling back to macOS say`);
  }

  const clauses = splitClauses(text);
  if (clauses.length === 1) {
    sayClauseToWav(clauses[0], outWav, workDir);
    return wavDuration(outWav);
  }
  const chunkDir = path.join(workDir, `${path.basename(outWav, ".wav")}-chunks`);
  fs.mkdirSync(chunkDir, { recursive: true });
  const sil = path.join(chunkDir, "sil.wav");
  const gapSec = (CLAUSE_GAP_MS / 1000).toFixed(3);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=mono",
      "-t",
      gapSec,
      sil,
    ],
    { stdio: "pipe" },
  );
  const listPath = path.join(chunkDir, "list.txt");
  const lines: string[] = [];
  clauses.forEach((clause, i) => {
    const wav = path.join(chunkDir, `c${i}.wav`);
    sayClauseToWav(clause, wav, chunkDir);
    lines.push(`file '${wav}'`);
    if (i < clauses.length - 1) lines.push(`file '${sil}'`);
  });
  fs.writeFileSync(listPath, lines.join("\n") + "\n", "utf8");
  execFileSync(
    "ffmpeg",
    ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outWav],
    { stdio: "pipe" },
  );
  return wavDuration(outWav);
}

function formatSrtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
}

function wrapCaption(text: string, maxChars = 22): string {
  const chars = [...text];
  if (chars.length <= maxChars) return text;
  const lines: string[] = [];
  let buf = "";
  for (const ch of chars) {
    buf += ch;
    if (buf.length >= maxChars && /[，。；！？、：,]/.test(ch)) {
      lines.push(buf);
      buf = "";
    } else if (buf.length >= maxChars + 6) {
      lines.push(buf);
      buf = "";
    }
  }
  if (buf) lines.push(buf);
  return lines.slice(0, 3).join("\n");
}

function buildCues(): Cue[] {
  return [
    {
      id: "open-title",
      vo: "大家好。今天用「华东零售」这套脱敏样例，给各位看 AgenticX 的 Data Suite。不讲底层代码，就讲管理员和分析师平时怎么把数据管住、取准、安全地问清楚。",
      caption: "华东零售 · Data Suite 产品演示",
      holdAfterMs: 250,
      run: async (page) => {
        await page.setContent(
          `<!doctype html><html><head><meta charset="utf-8"/><style>
            html,body{margin:0;height:100%;background:#0b1220;color:#f8fafc;font-family:-apple-system,"PingFang SC","Hiragino Sans GB",sans-serif}
            .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:48px;text-align:center}
            h1{font-size:48px;margin:0 0 18px;letter-spacing:1px}
            p{font-size:24px;line-height:1.7;max-width:980px;opacity:.92;margin:0}
            .tag{margin-top:28px;font-size:17px;color:#93c5fd;border:1px solid #334155;border-radius:999px;padding:8px 18px}
          </style></head><body><div class="wrap">
            <h1>AgenticX Data Suite</h1>
            <p>治理、取数、作业、ID 映射、定时任务、安全问数——管理台里一站操作。</p>
            <div class="tag">产品演示 · 华东零售脱敏 · 投资人 / 业务可读</div>
          </div></body></html>`,
          { waitUntil: "domcontentloaded" },
        );
        await pause(page, 700);
      },
    },
    {
      id: "open-why",
      vo: "一句话业务：字段口径散、取数容易越权、作业没人盯、同一人多个 ID 对不上，经营问数还怕写坏库。Data Suite 把治理、权限、作业、映射、定时，再加上安全问数，接到管理台：默认只读、写要开闸、展示默认脱敏。",
      caption: "管口径 · 控权限 · 盯作业 · 对 ID · 安全问数",
      holdAfterMs: 220,
      run: async (page) => {
        await page.setContent(
          `<!doctype html><html><head><meta charset="utf-8"/><style>
            html,body{margin:0;height:100%;background:#0b1220;color:#f8fafc;font-family:-apple-system,"PingFang SC","Hiragino Sans GB",sans-serif}
            .wrap{max-width:960px;margin:0 auto;padding:72px 48px}
            h2{font-size:30px;margin:0 0 28px;color:#93c5fd}
            ol{font-size:23px;line-height:2;margin:0;padding-left:1.4em}
            li{margin-bottom:8px}
          </style></head><body><div class="wrap">
            <h2>今天演示路径</h2>
            <ol>
              <li>登录管理台 · Dashboard</li>
              <li>数据治理：字典、清洗、分级、质量</li>
              <li>自助取数：权限 + 脱敏</li>
              <li>数据作业：调度与重跑</li>
              <li>ID 映射：冲突审阅</li>
              <li>定时任务</li>
              <li>安全问数：讲解 → 执行 → 写闸 → 邻域</li>
            </ol>
          </div></body></html>`,
          { waitUntil: "domcontentloaded" },
        );
        await pause(page, 600);
      },
    },
    {
      id: "admin-login",
      vo: "先登录管理台。管理员进来以后，数据相关入口都在左侧导航，中文界面一眼能找着。",
      caption: "管理台登录 → Dashboard",
      holdAfterMs: 250,
      focus: "main, [data-testid='admin-dashboard'], body",
      focusScale: 1.35,
      run: async (page) => {
        await adminLogin(page);
        await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
        await pause(page, 1000);
      },
    },
    {
      id: "governance",
      vo: "先看数据治理。这里管字段字典：谁负责、多久更新、业务定义是什么。管理员可以新增字段，刷新后还在，说明真写进库了。",
      caption: "数据治理：字段字典可写",
      holdAfterMs: 350,
      focus: '[data-testid="data-governance-fields"], [data-testid="data-governance-page"]',
      focusScale: 1.75,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.goto(`${ADMIN_BASE}/admin/data-governance`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page
          .getByTestId("data-governance-page")
          .waitFor({ state: "visible", timeout: 30_000 });
        await page
          .getByTestId("data-governance-fields")
          .waitFor({ state: "visible", timeout: 20_000 })
          .catch(() => undefined);
        await pause(page, 800);
      },
    },
    {
      id: "governance-ops",
      vo: "同一页还能切到清洗、分级、质量、审核。质量指标点一下运行，就能看到最近一轮结果。治理不是只写文档，是能在界面上运营的。",
      caption: "清洗 / 分级 / 质量 / 审核可运营",
      holdAfterMs: 380,
      focus: '[data-testid="data-governance-tabs"], [data-testid="data-governance-quality"]',
      focusScale: 1.8,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        const tab = page.getByTestId("data-governance-tab-quality");
        if (await tab.isVisible().catch(() => false)) {
          await tab.click();
          await page
            .getByTestId("data-governance-quality")
            .waitFor({ state: "visible", timeout: 10_000 })
            .catch(() => undefined);
        }
        await pause(page, 700);
      },
    },
    {
      id: "query-acl",
      vo: "再看自助取数和权限。敏感字段默认脱敏，页面带水印。越权取数会被拦住，或者只能看到打星的结果。默认只读，写操作要授权。",
      caption: "自助取数：权限校验 + 脱敏",
      holdAfterMs: 400,
      focus: '[data-testid="data-query-acl-panel"], [data-testid="data-security-page"], main',
      focusScale: 1.7,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.goto(`${ADMIN_BASE}/admin/data-security`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        const ok = await page
          .getByTestId("data-security-page")
          .waitFor({ state: "visible", timeout: 20_000 })
          .then(() => true)
          .catch(() => false);
        if (!ok) {
          await page.goto(`${ADMIN_BASE}/admin/data-query`, {
            waitUntil: "domcontentloaded",
            timeout: 30_000,
          });
        }
        await page
          .getByTestId("data-query-acl-panel")
          .waitFor({ state: "visible", timeout: 8_000 })
          .catch(() => undefined);
        await pause(page, 800);
      },
    },
    {
      id: "data-jobs",
      vo: "数据作业这一页，管理员能看到样例作业，比如成员同步。点调度或重跑，运行历史会多一条记录，成功失败一眼能看清。",
      caption: "数据作业：调度、历史、重跑",
      holdAfterMs: 350,
      focus: '[data-testid="data-jobs-page"], [data-testid="data-jobs-runs-table"]',
      focusScale: 1.7,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.goto(`${ADMIN_BASE}/admin/data-jobs`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page
          .getByTestId("data-jobs-page")
          .waitFor({ state: "visible", timeout: 30_000 });
        await page
          .getByTestId("data-jobs-row-golden_path_members")
          .waitFor({ state: "visible", timeout: 15_000 })
          .catch(() => undefined);
        await pause(page, 700);
      },
    },
    {
      id: "idmapping",
      vo: "ID 映射用来处理「同一个人多个号」的问题。样例里用假的手机号、邮箱类型，冲突表能打开，需要时人工裁决合并。不绑客户真实业务 ID。",
      caption: "ID 映射：假 ID 类型 + 冲突审阅",
      holdAfterMs: 380,
      focus: '[data-testid="data-idmapping-page"], [data-testid="data-idmapping-conflicts-table"]',
      focusScale: 1.75,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.goto(`${ADMIN_BASE}/admin/data-idmapping`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page
          .getByTestId("data-idmapping-page")
          .waitFor({ state: "visible", timeout: 30_000 });
        await page
          .getByTestId("data-idmapping-conflicts-table")
          .waitFor({ state: "visible", timeout: 10_000 })
          .catch(() => undefined);
        await pause(page, 700);
      },
    },
    {
      id: "schedules",
      vo: "定时任务在智能体运行下面。标题就是中文「定时任务」。按 cron 给智能体开独立会话，到点或手动跑，都会留下运行记录。",
      caption: "定时任务：cron → 独立会话",
      holdAfterMs: 350,
      focus: 'h1, main, [data-testid="agent-schedules-page"]',
      focusScale: 1.55,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.goto(`${ADMIN_BASE}/admin/agent-schedules`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page.waitForTimeout(800);
        const titleOk =
          (await page.getByText("定时任务").count()) > 0 ||
          (await page.getByText(/新建定时任务|还没有定时任务/i).count()) > 0;
        if (!titleOk) {
          console.warn("[demo] schedules Chinese title not obvious");
        }
        await pause(page, 700);
      },
    },
    {
      id: "safe-query-page",
      vo: "接下来是侧栏「安全问数」。用自然语言问经营数据，比如上月华东大区的 GMV 和退货率。先讲解、再执行，写操作走闸。",
      caption: "安全问数：自然语言经营问数",
      holdAfterMs: 320,
      focus: '[data-testid="data-nl2sql-form"], [data-testid="data-nl2sql-page"]',
      focusScale: 1.65,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.goto(`${ADMIN_BASE}/admin/data-nl2sql`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page
          .getByTestId("data-nl2sql-page")
          .waitFor({ state: "visible", timeout: 30_000 });
        await page
          .getByTestId("data-nl2sql-question")
          .waitFor({ state: "visible", timeout: 10_000 })
          .catch(() => undefined);
        await pause(page, 800);
      },
    },
    {
      id: "safe-query-explain",
      vo: "先选「讲解」再点运行。系统只生成 SQL 草案和计划，不真正访问通道。业务同学可以先看计划对不对。",
      caption: "讲解模式：只出 SQL 草案，不执行",
      holdAfterMs: 320,
      focus: '[data-testid="data-nl2sql-sql"], [data-testid="data-nl2sql-result"], [data-testid="data-nl2sql-mode"]',
      focusScale: 1.8,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.getByTestId("data-nl2sql-mode-explain").click();
        await page.getByTestId("data-nl2sql-run").click();
        await page
          .getByTestId("data-nl2sql-result")
          .waitFor({ state: "visible", timeout: 20_000 });
        await page
          .getByTestId("data-nl2sql-sql")
          .waitFor({ state: "visible", timeout: 10_000 })
          .catch(() => undefined);
        await pause(page, 700);
      },
    },
    {
      id: "safe-query-execute",
      vo: "确认计划没问题，切到「执行」再运行。这时才真正只读取数，结果表直接出来，比如华东大区的 GMV 和退货率。",
      caption: "执行模式：确认后只读取数",
      holdAfterMs: 350,
      focus: '[data-testid="data-nl2sql-rows"], [data-testid="data-nl2sql-result"]',
      focusScale: 1.85,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.getByTestId("data-nl2sql-mode-execute").click();
        await page.getByTestId("data-nl2sql-run").click();
        await page
          .getByTestId("data-nl2sql-rows")
          .waitFor({ state: "visible", timeout: 25_000 })
          .catch(() => undefined);
        await pause(page, 800);
      },
    },
    {
      id: "safe-query-write-gate",
      vo: "再演示写闸：点「填入写闸演示」，会塞进一条删除语句。未开闸时，写操作被直接拒绝，原因可读。",
      caption: "写闸：未开闸写操作被拒",
      holdAfterMs: 350,
      focus: '[data-testid="data-nl2sql-denial"], [data-testid="data-nl2sql-denial-reason"], [data-testid="data-nl2sql-result"]',
      focusScale: 1.85,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.getByTestId("data-nl2sql-demo-deny").click();
        await pause(page, 400);
        await page.getByTestId("data-nl2sql-run").click();
        await page
          .getByTestId("data-nl2sql-denial")
          .waitFor({ state: "visible", timeout: 20_000 });
        await pause(page, 700);
      },
    },
    {
      id: "safe-query-neighborhood",
      vo: "知识发布之后，还可以从生命周期页点「查看邻域」，在图谱探索里看实体周边关系。若本环境还没发布种子，这一步可以后补。",
      caption: "邻域：发布后可在图谱探索查看",
      holdAfterMs: 300,
      focus: '[data-testid="graph-explorer-canvas-card"], [data-testid="knowledge-lifecycle-neighborhood"], [data-testid="knowledge-lifecycle-view-neighborhood"], main',
      focusScale: 1.55,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        let showed = false;
        await page.goto(`${ADMIN_BASE}/admin/knowledge-lifecycle`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page.waitForTimeout(1200);
        const viewNb = page.getByTestId("knowledge-lifecycle-view-neighborhood");
        if (await viewNb.isVisible().catch(() => false)) {
          await viewNb.click();
          await page.waitForTimeout(1500);
          showed = true;
        } else {
          const nb = page.getByTestId("knowledge-lifecycle-neighborhood");
          if (await nb.isVisible().catch(() => false)) {
            showed = true;
          }
        }
        if (!showed) {
          await page.goto(`${ADMIN_BASE}/admin/graph-explorer`, {
            waitUntil: "domcontentloaded",
            timeout: 30_000,
          });
          await page
            .getByTestId("graph-explorer-page")
            .waitFor({ state: "visible", timeout: 20_000 })
            .catch(() => undefined);
          const empty = await page
            .getByTestId("graph-explorer-empty")
            .isVisible()
            .catch(() => false);
          const canvas = await page
            .getByTestId("graph-explorer-canvas-card")
            .isVisible()
            .catch(() => false);
          if (empty || !canvas) {
            console.warn(
              "[demo] neighborhood seed unavailable — skipping real neighborhood UI (VO notes 发布后可看邻域)",
            );
          } else {
            showed = true;
          }
        }
        await pause(page, 800);
      },
    },
    {
      id: "closing",
      vo: "演示到这儿。治理、权限、作业、映射、定时，再加上安全问数的讲解、执行和写闸。谢谢各位。",
      caption: "谢谢 · Data Suite 产品演示",
      holdAfterMs: 400,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.setContent(
          `<!doctype html><html><head><meta charset="utf-8"/><style>
            html,body{margin:0;height:100%;background:#0b1220;color:#f8fafc;font-family:-apple-system,"PingFang SC","Hiragino Sans GB",sans-serif}
            .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:48px;text-align:center;gap:18px}
            h1{font-size:38px;margin:0}
            p{font-size:23px;line-height:1.8;max-width:920px;margin:0;opacity:.92}
            .pill{margin-top:12px;font-size:18px;color:#86efac;border:1px solid #166534;border-radius:999px;padding:8px 18px}
          </style></head><body><div class="wrap">
            <h1>谢谢观看</h1>
            <p>治理 · 权限 · 作业 · ID 映射 · 定时 · 安全问数<br/>讲解 → 执行 → 写闸 · 默认只读</p>
            <div class="pill">华东零售脱敏样例 · AgenticX Data Suite</div>
          </div></body></html>`,
          { waitUntil: "domcontentloaded" },
        );
        await pause(page, 600);
      },
    },
  ];
}

async function resolveFocusSelector(
  page: Page,
  focus: string,
): Promise<string | null> {
  const parts = focus.split(",").map((s) => s.trim()).filter(Boolean);
  for (const sel of parts) {
    const ok = await page.locator(sel).first().isVisible().catch(() => false);
    if (ok) return sel;
  }
  return null;
}

async function main() {
  fs.mkdirSync(path.dirname(OUT_MP4), { recursive: true });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-ops-demo-"));
  const videoDir = path.join(workDir, "video");
  const audioDir = path.join(workDir, "audio");
  fs.mkdirSync(videoDir);
  fs.mkdirSync(audioDir);

  console.log(`[demo] workDir=${workDir}`);
  console.log(`[demo] out=${OUT_MP4}`);
  console.log(
    `[demo] TTS neural cache: dir=${TTS_CACHE_DIR} voice=${TTS_VOICE} rate=${TTS_RATE} clauseGapMs=${CLAUSE_GAP_MS} allowSay=${ALLOW_SAY}`,
  );
  console.log(
    `[demo] viewport=${VW}x${VH} deviceScaleFactor=${DEVICE_SCALE} camera=css-transform zoomTo/zoomOut`,
  );

  const cues = buildCues();

  const voMeta: Array<{
    id: string;
    wav: string;
    dur: number;
    caption: string;
    vo: string;
  }> = [];
  for (const cue of cues) {
    const wav = path.join(audioDir, `${cue.id}.wav`);
    const dur = sayToWav(cue.vo, wav, audioDir, cue.id);
    voMeta.push({
      id: cue.id,
      wav,
      dur,
      caption: cue.caption || cue.vo,
      vo: cue.vo,
    });
    console.log(`[demo] TTS ${cue.id}: ${dur.toFixed(2)}s`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: DEVICE_SCALE,
    recordVideo: { dir: videoDir, size: { width: VW, height: VH } },
  });
  const page = await context.newPage();

  const timeline: TimelineEntry[] = [];
  const t0 = Date.now();

  try {
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      const meta = voMeta[i];
      await safeStep(cue.id, async () => {
        const actionStart = (Date.now() - t0) / 1000;
        await cue.run(page);
        if (cue.focus) {
          const sel = await resolveFocusSelector(page, cue.focus);
          if (sel) {
            await zoomTo(page, sel, {
              scale: cue.focusScale ?? 1.85,
              durationMs: 850,
            });
          }
        }
        const voStart = (Date.now() - t0) / 1000;
        const holdMs = Math.ceil(meta.dur * 1000) + (cue.holdAfterMs ?? 250);
        await pause(page, holdMs);
        const voEnd = voStart + meta.dur;
        timeline.push({
          id: cue.id,
          vo: meta.vo,
          caption: meta.caption,
          startSec: voStart,
          endSec: voEnd,
          wav: meta.wav,
        });
        if (cue.focus) {
          await zoomOut(page, { durationMs: 700 });
        }
        console.log(
          `[demo] cue ${cue.id}: action@${actionStart.toFixed(1)}s vo@${voStart.toFixed(1)}-${voEnd.toFixed(1)}s focus=${cue.focus ?? "-"}`,
        );
      });
    }
    await pause(page, 1500);
  } finally {
    await context.close();
    await browser.close();
  }

  const webms = fs
    .readdirSync(videoDir)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => path.join(videoDir, f));
  if (webms.length < 1) {
    throw new Error(`no webm produced in ${videoDir}`);
  }
  const webm = webms[0];
  console.log(`[demo] webm=${webm} size=${fs.statSync(webm).size}`);

  const videoDur = Number(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=nokey=1:noprint_wrappers=1",
        webm,
      ],
      { encoding: "utf8" },
    ).trim(),
  );
  console.log(`[demo] videoDur=${videoDur.toFixed(2)}s`);

  const inputs: string[] = [];
  const filterParts: string[] = [];
  timeline.forEach((t, idx) => {
    inputs.push("-i", t.wav);
    const delayMs = Math.max(0, Math.round(t.startSec * 1000));
    filterParts.push(
      `[${idx}]adelay=${delayMs}|${delayMs},apad=whole_dur=${Math.max(videoDur, t.endSec + 1).toFixed(3)}[a${idx}]`,
    );
  });
  const mixInputs = timeline.map((_, i) => `[a${i}]`).join("");
  const filterComplex =
    filterParts.join(";") +
    `;${mixInputs}amix=inputs=${timeline.length}:duration=longest:dropout_transition=0:normalize=0[aout]`;

  const mixedWav = path.join(workDir, "vo-mixed.wav");
  console.log(`[demo] mixing ${timeline.length} VO clips…`);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      ...inputs,
      "-filter_complex",
      filterComplex,
      "-map",
      "[aout]",
      "-ar",
      "44100",
      "-ac",
      "1",
      mixedWav,
    ],
    { stdio: "pipe" },
  );

  const srtPath = path.join(workDir, "captions.srt");
  const srtBody = timeline
    .map((t, i) => {
      const end = Math.min(t.endSec + 0.35, videoDur);
      return `${i + 1}\n${formatSrtTime(t.startSec)} --> ${formatSrtTime(end)}\n${wrapCaption(t.caption)}\n`;
    })
    .join("\n");
  fs.writeFileSync(srtPath, srtBody, "utf8");

  const srtEscaped = srtPath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");

  const tmpMp4 = path.join(workDir, "out-nosub.mp4");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      webm,
      "-i",
      mixedWav,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "-movflags",
      "+faststart",
      tmpMp4,
    ],
    { stdio: "inherit" },
  );

  const forceStyle =
    "FontName=Arial Unicode MS,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BackColour=&H80000000,BorderStyle=4,Outline=1,Shadow=0,MarginV=48,Alignment=2";
  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-i",
        tmpMp4,
        "-vf",
        `subtitles=${srtEscaped}:fontsdir=/Library/Fonts:force_style='${forceStyle}'`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        OUT_MP4,
      ],
      { stdio: "inherit" },
    );
  } catch (err) {
    console.warn("[demo] subtitles filter failed, copying mux only", err);
    fs.copyFileSync(tmpMp4, OUT_MP4);
  }

  let hasAudio = false;
  try {
    const streams = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_streams",
        "-select_streams",
        "a",
        "-of",
        "csv=p=0",
        OUT_MP4,
      ],
      { encoding: "utf8" },
    ).trim();
    hasAudio = streams.length > 0;
  } catch {
    hasAudio = false;
  }

  const st = fs.statSync(OUT_MP4);
  let duration = "?";
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        OUT_MP4,
      ],
      { encoding: "utf8" },
    ).trim();
    duration = `${Number(out).toFixed(1)}s`;
  } catch {
    /* ignore */
  }

  const outSrt = OUT_MP4.replace(/\.mp4$/, ".zh.srt");
  fs.copyFileSync(srtPath, outSrt);

  console.log("==== DEMO SUMMARY ====");
  console.log(`mp4=${OUT_MP4}`);
  console.log(`srt=${outSrt}`);
  console.log(`size_bytes=${st.size}`);
  console.log(`duration=${duration}`);
  console.log(`has_audio=${hasAudio}`);
  console.log(`tts_voice=${TTS_VOICE}`);
  console.log(`tts_rate=${TTS_RATE}`);
  console.log(`viewport=${VW}x${VH}`);
  console.log(`camera=css-transform zoomTo/zoomOut`);
  console.log(`cues=${timeline.length}`);
  console.log("visited:");
  for (const v of visited) console.log(`  ${v}`);
  if (failures.length) {
    console.log("failures:");
    for (const f of failures) console.log(`  ${f}`);
  } else {
    console.log("failures: none");
  }

  try {
    execSync(`rm -rf "${workDir}"`, { stdio: "ignore" });
  } catch {
    /* ignore */
  }

  if (!hasAudio) process.exitCode = 2;
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[demo] FATAL", err);
  process.exit(1);
});
