/**
 * Record Managed Agent best-practice demo (real create → publish → portal @ run → 事件回放)
 * with Chinese VO + burned captions. Focus-ring-only camera (no CSS html zoom).
 * Forked from demo-ma-ops-manual-record.ts.
 *
 * Run (from repo root, box preferred headed on DISPLAY):
 *   set -a && source enterprise/.env.local && set +a
 *   DEMO_TTS_CACHE_DIR="$(pwd)/.runtime/agx-ma-bp-demo-tts" \
 *   DEMO_HEADED=1 DISPLAY=:2 \
 *     pnpm -C enterprise exec tsx scripts/demo-ma-best-practice-record.ts
 *
 * Cue manifest: docs/managed-agent/shots/ma-best-practice-cues.json
 */
import { chromium, type Page, type Locator } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, execSync } from "node:child_process";

const ADMIN_BASE = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3001";
const PORTAL_BASE = process.env.PORTAL_BASE_URL ?? "http://127.0.0.1:3000";
const ADMIN_EMAIL =
  process.env.ADMIN_CONSOLE_LOGIN_EMAIL?.trim() || "admin@agenticx.local";
const ADMIN_PASSWORD =
  process.env.ADMIN_CONSOLE_LOGIN_PASSWORD?.trim() ||
  process.env.AUTH_DEV_OWNER_PASSWORD?.trim() ||
  "ChangeMe_Dev14!Aa";
const PORTAL_EMAIL = process.env.PORTAL_LOGIN_EMAIL?.trim() || ADMIN_EMAIL;
const PORTAL_PASSWORD =
  process.env.PORTAL_LOGIN_PASSWORD?.trim() || ADMIN_PASSWORD;

const OUT_MP4 = path.resolve(
  __dirname,
  "../..",
  "docs/managed-agent/shots/ma-best-practice-demo.mp4",
);

const VW = Number(process.env.DEMO_VIEWPORT_W || "1600");
const VH = Number(process.env.DEMO_VIEWPORT_H || "1000");
const DEVICE_SCALE = Number(process.env.DEMO_DEVICE_SCALE || "1");
const HEADED =
  process.env.DEMO_HEADED === "1" ||
  process.env.DEMO_HEADED === "true" ||
  Boolean(process.env.DISPLAY && process.env.DEMO_HEADED !== "0");

const TTS_CACHE_DIR =
  process.env.DEMO_TTS_CACHE_DIR?.trim() ||
  path.resolve(__dirname, "../../.runtime/agx-ma-bp-demo-tts");
const TTS_VOICE =
  process.env.DEMO_TTS_VOICE?.trim() || "zh-CN-XiaoxiaoNeural";
const TTS_RATE = process.env.DEMO_TTS_RATE?.trim() || "+8%";
const SAY_RATE = Number(process.env.DEMO_SAY_RATE || "180");
const CLAUSE_GAP_MS = Number(process.env.DEMO_CLAUSE_GAP_MS || "180");
const ALLOW_SAY = process.env.DEMO_TTS_ALLOW_SAY === "1";

const AGENT_SLUG = process.env.DEMO_MA_BP_SLUG?.trim() || "bp-demo-bot";
const AGENT_NAME = process.env.DEMO_MA_BP_NAME?.trim() || "BP Demo Bot";
const LIVE_PROMPT =
  process.env.DEMO_MA_BP_PROMPT?.trim() ||
  `@${AGENT_SLUG} 请用一句话自我介绍`;
const SYSTEM_PROMPT =
  process.env.DEMO_MA_BP_SYSTEM?.trim() ||
  "你是 bp-demo-bot，托管智能体最佳实践演示助手。用一句中文简洁自我介绍即可。";

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

const CUES_JSON = path.resolve(
  __dirname,
  "../../docs/managed-agent/shots/ma-best-practice-cues.json",
);

type CueMeta = {
  id: string;
  vo?: string;
  text?: string;
  caption?: string;
  holdAfterMs?: number;
  focus?: string;
  focusScale?: number;
};

const demoState: {
  agentId: string;
  roomId: string;
  sessionId: string;
  modelId: string;
} = { agentId: "", roomId: "", sessionId: "", modelId: "" };

function loadCueMeta(): Map<string, CueMeta> {
  const map = new Map<string, CueMeta>();
  try {
    const raw = JSON.parse(fs.readFileSync(CUES_JSON, "utf8")) as {
      cues?: CueMeta[];
    };
    for (const c of raw.cues || []) {
      if (c?.id) map.set(c.id, c);
    }
    console.log(`[demo] loaded ${map.size} cue metas from ${CUES_JSON}`);
  } catch (err) {
    console.warn(`[demo] cue JSON load failed, using inline VO: ${err}`);
  }
  return map;
}

function applyCueMeta(cue: Cue, meta: CueMeta | undefined): Cue {
  if (!meta) return cue;
  return {
    ...cue,
    vo: (meta.vo || meta.text || cue.vo).trim(),
    caption: (meta.caption || cue.caption || cue.vo).trim(),
    holdAfterMs: meta.holdAfterMs ?? cue.holdAfterMs,
    focus: meta.focus ?? cue.focus,
    focusScale: meta.focusScale ?? cue.focusScale,
  };
}

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
  void opts?.scale;
  const durationMs = opts?.durationMs ?? 400;
  const ringPad = opts?.padding ?? 8;
  const loc = page.locator(selector).first();
  const visible = await loc.isVisible().catch(() => false);
  if (!visible) {
    console.warn(`[demo] zoomTo miss: ${selector}`);
    return;
  }
  await loc.scrollIntoViewIfNeeded().catch(() => undefined);
  await page
    .evaluate(
      ({ sel, ringPad }) => {
        const el = document.querySelector(sel);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const targetY = window.innerHeight * 0.42;
        const delta = r.top + r.height / 2 - targetY;
        if (Math.abs(delta) > 24) {
          window.scrollBy({ top: delta - ringPad * 2, behavior: "auto" });
        }
      },
      { sel: selector, ringPad },
    )
    .catch(() => undefined);
  await page.waitForTimeout(120);
  await page.evaluate(
    ({ sel, durationMs, ringPad }) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const inset = 8;
      const html = document.documentElement as HTMLElement;
      html.style.transition = "";
      html.style.transform = "";
      html.style.transformOrigin = "";
      delete (html as HTMLElement & { dataset: DOMStringMap }).dataset
        .demoZoomScale;

      let left = r.left - ringPad;
      let top = r.top - ringPad;
      let width = r.width + ringPad * 2;
      let height = r.height + ringPad * 2;
      left = Math.max(inset, Math.min(left, vw - inset - 16));
      top = Math.max(inset, Math.min(top, vh - inset - 16));
      width = Math.min(width, vw - inset - left);
      height = Math.min(height, vh - inset - top);
      width = Math.max(16, width);
      height = Math.max(16, height);

      let ring = document.getElementById("demo-zoom-ring");
      if (!ring) {
        ring = document.createElement("div");
        ring.id = "demo-zoom-ring";
        document.body.appendChild(ring);
      }
      Object.assign(ring.style, {
        position: "fixed",
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        border: "2px solid rgba(96,165,250,0.95)",
        borderRadius: "10px",
        boxShadow:
          "0 0 0 9999px rgba(15,23,42,0.28), 0 0 24px rgba(59,130,246,0.45)",
        pointerEvents: "none",
        zIndex: "2147483646",
        transition: `opacity ${Math.min(280, durationMs)}ms ease`,
        transform: "none",
        transformOrigin: "unset",
        opacity: "1",
      } as CSSStyleDeclaration);
    },
    { sel: selector, durationMs, ringPad },
  );
  await page.waitForTimeout(Math.min(durationMs, 280) + 40);
}

async function zoomOut(
  page: Page,
  opts?: { durationMs?: number },
): Promise<void> {
  const durationMs = opts?.durationMs ?? 280;
  await page
    .evaluate((durationMs) => {
      const html = document.documentElement as HTMLElement;
      html.style.transition = "";
      html.style.transform = "";
      html.style.transformOrigin = "";
      delete (html as HTMLElement & { dataset: DOMStringMap }).dataset
        .demoZoomScale;
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

async function portalLogin(page: Page): Promise<void> {
  const api = await page.request.post(`${PORTAL_BASE}/api/auth/login`, {
    data: { email: PORTAL_EMAIL, password: PORTAL_PASSWORD },
  });
  if (api.ok()) {
    await page.goto(`${PORTAL_BASE}/workspace`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    if (!page.url().includes("/auth")) {
      await dismissNextOverlay(page);
      return;
    }
  }
  await page.goto(`${PORTAL_BASE}/auth`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  await dismissNextOverlay(page);
  const email = page.locator('input[type="email"]').first();
  const password = page.locator('input[type="password"]').first();
  await email.waitFor({ state: "visible", timeout: 20_000 });
  await email.fill(PORTAL_EMAIL);
  await password.fill(PORTAL_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/workspace/, { timeout: 45_000 }),
    page.locator('button[type="submit"]').first().click({ force: true }),
  ]);
  await dismissNextOverlay(page);
}

async function ensureCleanAgent(page: Page): Promise<void> {
  const list = await page.request.get(`${ADMIN_BASE}/api/admin/agents`, {
    headers: { Accept: "application/json" },
  });
  if (!list.ok()) return;
  const json = (await list.json()) as {
    data?: { agents?: Array<{ id: string; slug: string }> };
  };
  for (const agent of json.data?.agents ?? []) {
    if (agent.slug === AGENT_SLUG) {
      await page.request
        .delete(`${ADMIN_BASE}/api/admin/agents/${agent.id}`)
        .catch(() => undefined);
      console.log(`[demo] deleted prior agent ${agent.slug}`);
    }
  }
}

async function pickModelId(page: Page): Promise<string> {
  const res = await page.request.get(`${ADMIN_BASE}/api/admin/providers`);
  if (!res.ok()) throw new Error(`providers HTTP ${res.status()}`);
  const json = (await res.json()) as {
    data?: {
      providers?: Array<{
        id: string;
        displayName: string;
        enabled: boolean;
        models: Array<{ name: string; label: string; enabled: boolean }>;
      }>;
    };
  };
  for (const provider of json.data?.providers ?? []) {
    if (!provider.enabled) continue;
    for (const model of provider.models) {
      if (!model.enabled) continue;
      const id = `${provider.id}/${model.name}`;
      if (provider.id === "demo-local" || model.name === "bp-demo-chat") {
        return id;
      }
    }
  }
  for (const provider of json.data?.providers ?? []) {
    if (!provider.enabled) continue;
    for (const model of provider.models) {
      if (model.enabled) return `${provider.id}/${model.name}`;
    }
  }
  throw new Error("no enabled model for agent create");
}

async function selectRadixOption(
  page: Page,
  trigger: Locator,
  optionRe: RegExp,
): Promise<void> {
  await trigger.click({ force: true });
  await page.waitForTimeout(250);
  const opt = page.getByRole("option", { name: optionRe }).first();
  if (await opt.isVisible().catch(() => false)) {
    await opt.click({ force: true });
    return;
  }
  // fallback: any listitem / div role option text
  const alt = page.locator("[role='option'], [data-radix-collection-item]").filter({ hasText: optionRe }).first();
  await alt.click({ force: true });
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
  const meta = loadCueMeta();
  const withMeta = (cue: Cue): Cue => applyCueMeta(cue, meta.get(cue.id));

  const gotoAdmin = async (page: Page, route: string) => {
    await zoomOut(page, { durationMs: 350 }).catch(() => undefined);
    await page.goto(`${ADMIN_BASE}${route}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(1100);
    await dismissNextOverlay(page);
  };

  const raw: Cue[] = [
    {
      id: "open-title",
      vo: "大家好。今天演示托管智能体的最佳实践主路径。",
      caption: "托管智能体 · 最佳实践主路径",
      holdAfterMs: 250,
      run: async (page) => {
        await page.setContent(
          `<!doctype html><html><head><meta charset="utf-8"/><style>
            html,body{margin:0;height:100%;background:#0b1220;color:#f8fafc;font-family:-apple-system,"PingFang SC","Noto Sans CJK SC",sans-serif}
            .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:48px;text-align:center}
            h1{font-size:46px;margin:0 0 18px;letter-spacing:1px}
            p{font-size:23px;line-height:1.7;max-width:980px;opacity:.92;margin:0}
            .tag{margin-top:28px;font-size:17px;color:#93c5fd;border:1px solid #334155;border-radius:999px;padding:8px 18px}
          </style></head><body><div class="wrap">
            <h1>托管智能体 · 最佳实践</h1>
            <p>管理台新建并发布 → 门户房间 @ 验跑 → 会话事件回放。</p>
            <div class="tag">产品演示 · 真实主路径 · 投资人 / 业务可读</div>
          </div></body></html>`,
          { waitUntil: "domcontentloaded" },
        );
        await pause(page, 700);
      },
    },
    {
      id: "open-why",
      vo: "业务就三步：定义云端智能体，发布给可见范围，员工在协作房间点名调用。",
      caption: "新建 → 发布 → 房间验跑 → 事件回放",
      holdAfterMs: 220,
      run: async (page) => {
        await page.setContent(
          `<!doctype html><html><head><meta charset="utf-8"/><style>
            html,body{margin:0;height:100%;background:#0b1220;color:#f8fafc;font-family:-apple-system,"PingFang SC","Noto Sans CJK SC",sans-serif}
            .wrap{max-width:960px;margin:0 auto;padding:72px 48px}
            h2{font-size:30px;margin:0 0 28px;color:#93c5fd}
            ol{font-size:23px;line-height:2;margin:0;padding-left:1.4em}
            li{margin-bottom:8px}
          </style></head><body><div class="wrap">
            <h2>今天演示路径</h2>
            <ol>
              <li>登录管理台 · 确认已启用模型</li>
              <li>新建 bp-demo-bot（云端 · 无 MCP / 知识库）</li>
              <li>发布智能体</li>
              <li>门户协作房间添加并 @ 验跑</li>
              <li>托管会话列表 → 事件回放</li>
            </ol>
          </div></body></html>`,
          { waitUntil: "domcontentloaded" },
        );
        await pause(page, 600);
      },
    },
    {
      id: "admin-login",
      vo: "先登录管理台。",
      caption: "管理台登录 · Dashboard",
      holdAfterMs: 280,
      focus: "nav, aside, [data-testid='admin-dashboard'], main, body",
      run: async (page) => {
        await adminLogin(page);
        await ensureCleanAgent(page);
        demoState.modelId = await pickModelId(page);
        console.log(`[demo] modelId=${demoState.modelId}`);
        await page.waitForURL(/\/dashboard/, { timeout: 10_000 }).catch(() => undefined);
        await pause(page, 900);
      },
    },
    {
      id: "models-ready",
      vo: "落地前确认平台模型页至少有一个已启用模型。",
      caption: "平台 → 模型：已启用可用模型",
      holdAfterMs: 320,
      focus: "main table, main, body",
      run: async (page) => {
        await gotoAdmin(page, "/admin/models");
        await page
          .getByText(/模型|Models|演示本地|demo-local|bp-demo/i)
          .first()
          .waitFor({ state: "visible", timeout: 12_000 })
          .catch(() => undefined);
        await pause(page, 800);
      },
    },
    {
      id: "agent-create",
      vo: "打开智能体页，新建 bp-demo-bot。",
      caption: "新建 bp-demo-bot · 云端 · 无 MCP/知识库",
      holdAfterMs: 360,
      focus: "[role='dialog'], main",
      run: async (page) => {
        await gotoAdmin(page, "/admin/agents");
        const createBtn = page.getByRole("button", { name: /新建智能体|New agent/i }).first();
        await createBtn.waitFor({ state: "visible", timeout: 15_000 });
        await createBtn.click({ force: true });
        const dialog = page.locator("[role='dialog']").first();
        await dialog.waitFor({ state: "visible", timeout: 10_000 });
        await dialog.locator("#agent-name").fill(AGENT_NAME);
        await dialog.locator("#agent-slug").fill(AGENT_SLUG);
        await dialog
          .locator("#agent-description")
          .fill("最佳实践演示：云端托管，无 MCP / 知识库。");
        // model select
        const modelTrigger = dialog.locator("button").filter({ hasText: /选择已启用的模型|Select|模型|model/i }).first();
        const modelTriggers = dialog.locator('[role="combobox"], button[aria-haspopup="listbox"]');
        const modelBtn =
          (await modelTrigger.isVisible().catch(() => false))
            ? modelTrigger
            : modelTriggers.nth(0);
        const modelName = demoState.modelId.split("/")[1] || "bp-demo-chat";
        await selectRadixOption(
          page,
          modelBtn,
          new RegExp(`${modelName}|demo-local|BP Demo|演示`, "i"),
        );
        // runtime already cloud by default; ensure
        const runtimeBtn = modelTriggers.nth(1);
        if (await runtimeBtn.isVisible().catch(() => false)) {
          const cur = (await runtimeBtn.textContent().catch(() => "")) || "";
          if (!/云端|cloud/i.test(cur)) {
            await selectRadixOption(page, runtimeBtn, /云端执行|cloud/i);
          }
        }
        await dialog.locator("#agent-prompt").fill(SYSTEM_PROMPT);
        // leave knowledge empty; do not toggle mcp/skills
        const save = dialog.getByRole("button", { name: /保存|Save/i }).first();
        await save.click({ force: true });
        await page.waitForTimeout(1200);
        // refresh list / capture id
        const list = await page.request.get(`${ADMIN_BASE}/api/admin/agents`);
        const json = (await list.json()) as {
          data?: { agents?: Array<{ id: string; slug: string }> };
        };
        const created = (json.data?.agents ?? []).find((a) => a.slug === AGENT_SLUG);
        if (!created) throw new Error(`agent ${AGENT_SLUG} not found after create`);
        demoState.agentId = created.id;
        console.log(`[demo] created agentId=${demoState.agentId}`);
        await page.goto(`${ADMIN_BASE}/admin/agents`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page.waitForTimeout(800);
        await page.getByText(AGENT_SLUG).first().waitFor({ state: "visible", timeout: 10_000 });
        await pause(page, 600);
      },
    },
    {
      id: "agent-publish",
      vo: "草稿就绪后点发布。",
      caption: "发布 bp-demo-bot",
      holdAfterMs: 320,
      focus: "table, main",
      run: async (page) => {
        await gotoAdmin(page, "/admin/agents");
        const row = page.locator("tr").filter({ hasText: AGENT_SLUG }).first();
        await row.waitFor({ state: "visible", timeout: 12_000 });
        const publish = row.getByRole("button", { name: /发布|Publish/i }).first();
        if (await publish.isVisible().catch(() => false)) {
          await publish.click({ force: true });
          await page.waitForTimeout(1200);
        } else {
          // already published?
          const badge = row.getByText(/已发布|Published/i).first();
          if (!(await badge.isVisible().catch(() => false))) {
            throw new Error("publish button missing and not published");
          }
        }
        await page.getByText(/已发布|Published/i).first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
        await pause(page, 700);
      },
    },
    {
      id: "portal-room",
      vo: "切到门户，进协作房间。",
      caption: "门户 → 协作房间",
      holdAfterMs: 300,
      focus: "main, body",
      run: async (page) => {
        await zoomOut(page, { durationMs: 350 }).catch(() => undefined);
        await portalLogin(page);
        await page.goto(`${PORTAL_BASE}/rooms`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page.waitForTimeout(1000);
        await dismissNextOverlay(page);
        // create room if needed
        const newBtn = page.getByRole("button", { name: /新建房间|New room|创建/i }).first();
        if (await newBtn.isVisible().catch(() => false)) {
          await newBtn.click({ force: true });
          await page.waitForTimeout(400);
          const nameInput = page.locator('input[placeholder*="房间"], input[name="title"], [role="dialog"] input').first();
          if (await nameInput.isVisible().catch(() => false)) {
            await nameInput.fill("BP Demo Room");
          }
          const confirm = page.getByRole("button", { name: /^创建$|^Create$|创建房间/i }).last();
          if (await confirm.isVisible().catch(() => false)) {
            await confirm.click({ force: true });
          }
          await page.waitForTimeout(1200);
        }
        // enter first / matching room
        if (!/\/rooms\/[^/]+/.test(page.url())) {
          const card = page.locator("a[href*='/rooms/'], [data-room-id]").first();
          if (await card.isVisible().catch(() => false)) {
            await card.click({ force: true });
            await page.waitForTimeout(1000);
          }
        }
        const m = page.url().match(/\/rooms\/([^/?#]+)/);
        if (m) demoState.roomId = m[1];
        console.log(`[demo] roomId=${demoState.roomId || "(unknown)"} url=${page.url()}`);
        await pause(page, 800);
      },
    },
    {
      id: "room-add-agent",
      vo: "在成员面板把 bp-demo-bot 加进房间。",
      caption: "房间成员 → 添加智能体",
      holdAfterMs: 300,
      focus: "aside, [data-testid='room-members'], main, body",
      run: async (page) => {
        if (demoState.roomId) {
          await page.goto(`${PORTAL_BASE}/rooms/${demoState.roomId}`, {
            waitUntil: "domcontentloaded",
            timeout: 30_000,
          });
          await page.waitForTimeout(900);
        }
        await dismissNextOverlay(page);
        // Precise add: aside button showing @slug (never match 离开房间 / 添加成员)
        const addAgentBtn = page
          .locator("aside button")
          .filter({ hasText: new RegExp(`@${AGENT_SLUG}`, "i") })
          .first();
        if (await addAgentBtn.isVisible().catch(() => false)) {
          await addAgentBtn.click({ force: true });
          await page.waitForTimeout(800);
        }
        // Always ensure membership via API (idempotent)
        if (demoState.roomId && demoState.agentId) {
          const res = await page.request.post(
            `${PORTAL_BASE}/api/rooms/${demoState.roomId}/members`,
            { data: { agent_id: demoState.agentId } },
          );
          console.log(`[demo] API add agent status=${res.status()}`);
        }
        // Stay on room page (cancel leave dialog if opened by mistake)
        const cancelLeave = page.getByRole("button", { name: /取消|Cancel/i }).first();
        if (await cancelLeave.isVisible().catch(() => false)) {
          await cancelLeave.click({ force: true }).catch(() => undefined);
        }
        if (demoState.roomId && !page.url().includes(demoState.roomId)) {
          await page.goto(`${PORTAL_BASE}/rooms/${demoState.roomId}`, {
            waitUntil: "domcontentloaded",
            timeout: 30_000,
          });
          await page.waitForTimeout(800);
        }
        await page
          .getByText(new RegExp(`@?${AGENT_SLUG}|${AGENT_NAME}`, "i"))
          .first()
          .waitFor({ state: "visible", timeout: 10_000 })
          .catch(() => undefined);
        await pause(page, 700);
      },
    },
    {
      id: "room-live-run",
      vo: "输入 at bp-demo-bot，请用一句话自我介绍，发送后等智能体气泡回来。",
      caption: "@bp-demo-bot 一句话自我介绍",
      holdAfterMs: 400,
      focus: "form, textarea, input, main",
      run: async (page) => {
        if (demoState.roomId) {
          await page.goto(`${PORTAL_BASE}/rooms/${demoState.roomId}`, {
            waitUntil: "domcontentloaded",
            timeout: 30_000,
          });
          await page.waitForTimeout(1000);
        }
        await dismissNextOverlay(page);
        const composer = page
          .locator(
            "form input[type='text'], textarea, input[placeholder*='输入'], input[placeholder*='消息'], input[placeholder*='Type']",
          )
          .first();
        await composer.waitFor({ state: "visible", timeout: 20_000 });
        await composer.click({ force: true });
        await composer.fill(LIVE_PROMPT);
        await page.waitForTimeout(400);
        const send = page.locator("form button[type='submit'], form button").filter({ hasText: /发送|Send/i }).first();
        await send.click({ force: true });
        // API fallback send if UI submit didn't enqueue
        await page.waitForTimeout(800);
        const pre = await page.request.get(
          `${PORTAL_BASE}/api/rooms/${demoState.roomId}/messages`,
        );
        let count = 0;
        if (pre.ok()) {
          const body = (await pre.json()) as { data?: { messages?: unknown[]; items?: unknown[] } };
          count = (body.data?.messages ?? body.data?.items ?? []).length;
        }
        // Wait for agent bubble (UI) and/or API agent message
        let gotAgent = false;
        for (let i = 0; i < 45; i++) {
          const bubble = page
            .locator("div")
            .filter({ hasText: /云端托管智能体|演示助手|我是 bp-demo-bot/i })
            .last();
          if (await bubble.isVisible().catch(() => false)) {
            gotAgent = true;
            break;
          }
          const msgs = await page.request.get(
            `${PORTAL_BASE}/api/rooms/${demoState.roomId}/messages`,
          );
          if (msgs.ok()) {
            const body = (await msgs.json()) as {
              data?: { messages?: Array<{ sender_type?: string; content?: string }>; items?: Array<{ sender_type?: string; content?: string }> };
            };
            const items = body.data?.messages ?? body.data?.items ?? [];
            if (
              items.some(
                (m) =>
                  m.sender_type === "agent" &&
                  Boolean(m.content) &&
                  !/retries_exhausted|不可用/.test(m.content || ""),
              )
            ) {
              gotAgent = true;
              // refresh UI
              await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
              await page.waitForTimeout(800);
              break;
            }
            if (i === 2 && items.length <= count) {
              // resend via API once
              const resend = await page.request.post(
                `${PORTAL_BASE}/api/rooms/${demoState.roomId}/messages`,
                { data: { content: LIVE_PROMPT } },
              );
              console.log(`[demo] API resend status=${resend.status()}`);
            }
          }
          await page.waitForTimeout(2000);
        }
        if (!gotAgent) {
          throw new Error("agent bubble did not arrive for live run");
        }
        console.log(`[demo] live agent bubble ok`);
        await page.waitForTimeout(1500);
        // resolve session id via admin API for later cues
        await page.request.post(`${ADMIN_BASE}/api/auth/login`, {
          data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
        });
        const sessions = await page.request.get(
          `${ADMIN_BASE}/api/admin/ma-sessions?limit=20`,
        );
        if (sessions.ok()) {
          const body = (await sessions.json()) as {
            data?: { items?: Array<{ id: string; agentId?: string; stopReason?: { type?: string } }> };
            items?: Array<{ id: string; agentId?: string; stopReason?: { type?: string } }>;
          };
          const items = body.data?.items ?? body.items ?? [];
          const hit =
            items.find(
              (s) =>
                s.agentId === demoState.agentId &&
                s.stopReason?.type !== "retries_exhausted",
            ) ||
            items.find((s) => s.agentId === demoState.agentId) ||
            items[0];
          if (hit?.id) {
            demoState.sessionId = hit.id;
            console.log(`[demo] sessionId=${demoState.sessionId}`);
          }
        } else {
          console.warn(`[demo] ma-sessions list HTTP ${sessions.status()}`);
        }
        await pause(page, 800);
      },
    },
    {
      id: "sessions-list",
      vo: "回到管理台会话页。",
      caption: "智能体运行 → 托管会话",
      holdAfterMs: 320,
      focus: "main table, main",
      run: async (page) => {
        await adminLogin(page);
        await gotoAdmin(page, "/ops/logs/managed");
        const refresh = page.getByRole("button", { name: /刷新|Refresh|查询/i }).first();
        if (await refresh.isVisible().catch(() => false)) {
          await refresh.click({ force: true }).catch(() => undefined);
          await page.waitForTimeout(900);
        }
        // if still no sessionId, try scrape first row link
        if (!demoState.sessionId) {
          const link = page.locator("a[href*='/ops/logs/managed/']").first();
          const href = await link.getAttribute("href").catch(() => null);
          const m = href?.match(/\/ops\/logs\/managed\/([^/?#]+)/);
          if (m) demoState.sessionId = m[1];
        }
        await pause(page, 800);
      },
    },
    {
      id: "session-trace",
      vo: "点进会话详情，看事件回放。",
      caption: "会话详情 · 事件回放",
      holdAfterMs: 380,
      focus: "[data-testid='session-replay'], main section, main",
      run: async (page) => {
        if (!demoState.sessionId) {
          await page.request.post(`${ADMIN_BASE}/api/auth/login`, {
            data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
          });
          const sessions = await page.request.get(
            `${ADMIN_BASE}/api/admin/ma-sessions?limit=10`,
          );
          if (sessions.ok()) {
            const body = (await sessions.json()) as {
              data?: { items?: Array<{ id: string }> };
            };
            const items = body.data?.items ?? [];
            if (items[0]?.id) demoState.sessionId = items[0].id;
          }
        }
        if (!demoState.sessionId) {
          const link = page.locator("a[href*='/ops/logs/managed/']").first();
          const href = await link.getAttribute("href").catch(() => null);
          const m = href?.match(/\/ops\/logs\/managed\/([^/?#]+)/);
          if (m) demoState.sessionId = m[1];
          else {
            await link.click({ force: true });
            await page.waitForTimeout(1200);
            const m2 = page.url().match(/\/ops\/logs\/managed\/([^/?#]+)/);
            if (m2) demoState.sessionId = m2[1];
          }
        }
        if (!demoState.sessionId) {
          throw new Error("no sessionId for event replay");
        }
        await gotoAdmin(page, `/ops/logs/managed/${demoState.sessionId}`);
        await page.waitForTimeout(1200);
        const timeline = page.getByText(/事件回放|Event replay|用户消息/i).first();
        await timeline.waitFor({ state: "visible", timeout: 30_000 });
        await timeline.scrollIntoViewIfNeeded().catch(() => undefined);
        await pause(page, 900);
      },
    },
    {
      id: "closing",
      vo: "演示到这儿。谢谢各位。",
      caption: "谢谢 · 托管智能体最佳实践",
      holdAfterMs: 400,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.setContent(
          `<!doctype html><html><head><meta charset="utf-8"/><style>
            html,body{margin:0;height:100%;background:#0b1220;color:#f8fafc;font-family:-apple-system,"PingFang SC","Noto Sans CJK SC",sans-serif}
            .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:48px;text-align:center;gap:18px}
            h1{font-size:38px;margin:0}
            p{font-size:23px;line-height:1.8;max-width:920px;margin:0;opacity:.92}
            .pill{margin-top:12px;font-size:18px;color:#86efac;border:1px solid #166534;border-radius:999px;padding:8px 18px}
          </style></head><body><div class="wrap">
            <h1>谢谢观看</h1>
            <p>云端新建并发布 · 房间 @ 验跑 · 事件回放可审计</p>
            <div class="pill">托管智能体 · 最佳实践主路径</div>
          </div></body></html>`,
          { waitUntil: "domcontentloaded" },
        );
        await pause(page, 600);
      },
    },
  ];

  return raw.map(withMeta);
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
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ma-bp-demo-"));
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
    `[demo] viewport=${VW}x${VH} deviceScaleFactor=${DEVICE_SCALE} camera=focus-ring-only (no css zoom) headed=${HEADED} DISPLAY=${process.env.DISPLAY || ""}`,
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

  const browser = await chromium.launch({
    headless: !HEADED,
    args: HEADED
      ? ["--no-sandbox", "--disable-dev-shm-usage", `--window-size=${VW},${VH}`]
      : ["--no-sandbox", "--disable-dev-shm-usage"],
  });
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
              durationMs: 320,
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
          await zoomOut(page, { durationMs: 280 });
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

  const fontsDir =
    process.env.DEMO_FONTS_DIR?.trim() ||
    (fs.existsSync("/usr/share/fonts/opentype/noto")
      ? "/usr/share/fonts/opentype/noto"
      : fs.existsSync("/Library/Fonts")
        ? "/Library/Fonts"
        : "/usr/share/fonts");
  const fontName =
    process.env.DEMO_FONT_NAME?.trim() ||
    (fontsDir.includes("noto") ? "Noto Sans CJK SC" : "Arial Unicode MS");
  const forceStyle = `FontName=${fontName},FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BackColour=&H80000000,BorderStyle=4,Outline=1,Shadow=0,MarginV=48,Alignment=2`;
  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-i",
        tmpMp4,
        "-vf",
        `subtitles=${srtEscaped}:fontsdir=${fontsDir}:force_style='${forceStyle}'`,
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
  console.log(`camera=focus-ring-only (no css zoom)`);
  console.log(`headed=${HEADED}`);
  console.log(`agentId=${demoState.agentId}`);
  console.log(`roomId=${demoState.roomId}`);
  console.log(`sessionId=${demoState.sessionId}`);
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
