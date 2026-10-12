/**
 * Prompt-drawn cube skins. Same mold as catalog colorways; no speckles.
 * Author: Damon Li
 */
import type { CubeColorway } from "./cube-colorway";
import { contrastEyeHex, readableCubeFill, rememberCustomCubeColorway } from "./cube-colorway";

const HEX = /^#(?:[0-9a-fA-F]{6})$/;

export const CUBE_GACHA_SYSTEM_PROMPT = [
  "你在给一颗软胶潮玩立方体抽卡上色。",
  "只输出一段 JSON，不要解释、不要 Markdown 围栏。",
  "模具固定，只能改颜色。禁止斑点、芝麻、大理石、碎点、颗粒、泼墨。",
  "kind 只能是 dual 或 dream。",
  'dual: {"kind":"dual","lid":"#RRGGBB","body":"#RRGGBB","eye":"#FFFFFF"}',
  'dream: {"kind":"dream","stops":["#RRGGBB","#RRGGBB","#RRGGBB"],"angle":32,"eye":"#FFFFFF"}',
  "颜色要干净大色块，盖和身对比清楚。",
  "body / 渐变最后一档不要纯白或近白，浅色也要带一点灰或颜色，免得在浅色背景上看不见下半身。",
  "眼睛必须和眼睛所在的那面形成对比：浅色身用深色眼睛（#1C1917），深色身用白眼睛（#FFFFFF）。禁止白身白眼。",
].join("\n");

export function parseGachaCubeColorway(raw: string, id?: string): CubeColorway | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const fenced = text.match(/\{[\s\S]*\}/);
  if (!fenced) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fenced[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const kind = String(parsed.kind || "").trim();
  if (kind === "marble" || kind === "shade") return null;
  const skinId = String(id || "").trim() || `gacha-${Date.now().toString(36)}`;
  if (kind === "dual") {
    const lid = hexOr(parsed.lid, "");
    const body = readableCubeFill(hexOr(parsed.body, ""));
    if (!lid || !body) return null;
    return { id: skinId, kind: "dual", lid, body, eye: contrastEyeHex(body) };
  }
  if (kind === "dream") {
    const stops = Array.isArray(parsed.stops)
      ? parsed.stops.map((item) => hexOr(item, "")).filter(Boolean)
      : [];
    if (stops.length < 3) return null;
    const normalized = [...stops.slice(0, 3)];
    normalized[2] = readableCubeFill(normalized[2] || normalized[0]);
    const angle = Number(parsed.angle);
    return {
      id: skinId,
      kind: "dream",
      stops: normalized,
      angle: Number.isFinite(angle) ? Math.max(0, Math.min(180, Math.round(angle))) : 32,
      eye: contrastEyeHex(normalized[2] || normalized[0]),
    };
  }
  return null;
}

function hexOr(value: unknown, fallback: string): string {
  const raw = String(value || "").trim();
  return HEX.test(raw) ? raw.toUpperCase() : fallback;
}

export function commitGachaCubeColorway(raw: string): CubeColorway | null {
  const way = parseGachaCubeColorway(raw);
  if (!way) return null;
  rememberCustomCubeColorway(way);
  return way;
}
