import { adaptSvgMarkupColors } from "./adapt-svg-theme";
import { mermaidThemeFromApp, renderMermaidSvg } from "./mermaid-render";
import type { ShareImageGraphicSource, ShareImageTurn } from "./share-image-model";

export type HydratedShareGraphic =
  | { status: "ready"; title?: string; svgHtml: string }
  | { status: "fallback"; hint: string };

export type HydratedAssistantPart =
  | { kind: "md"; text: string }
  | { kind: "graphic"; graphic: HydratedShareGraphic };

export type HydratedShareTurn =
  | { kind: "user"; text: string }
  | { kind: "assistant"; parts: HydratedAssistantPart[] }
  | { kind: "widget"; graphic: HydratedShareGraphic };

function stripUnsafeSvg(markup: string): string {
  return markup
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

/** Replace `var(--token)` with computed values so html-to-image can rasterize. */
export function resolveCssVarsInMarkup(markup: string): string {
  if (typeof document === "undefined") return markup;
  const styles = getComputedStyle(document.documentElement);
  return markup.replace(
    /var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([^)]+))?\)/g,
    (full, name: string, fallback?: string) => {
      const value = styles.getPropertyValue(name).trim();
      if (value) return value;
      const fb = fallback?.trim();
      return fb || full;
    },
  );
}

function prepareSvgHtml(markup: string): string {
  return resolveCssVarsInMarkup(adaptSvgMarkupColors(stripUnsafeSvg(markup)));
}

export async function hydrateShareGraphic(
  source: ShareImageGraphicSource,
  opts: { appTheme: string; renderId: string },
): Promise<HydratedShareGraphic> {
  if (source.kind === "unsupported") {
    return { status: "fallback", hint: source.hint };
  }
  if (source.kind === "svg") {
    const svgHtml = prepareSvgHtml(source.code);
    if (!/<svg\b/i.test(svgHtml)) {
      return {
        status: "fallback",
        hint: source.title
          ? `[图表：${source.title}]（无法导出为静态图片，请在应用内查看）`
          : "（含图表，请以应用内为准）",
      };
    }
    return { status: "ready", title: source.title, svgHtml };
  }

  const chartTitle = source.title || "图表";
  try {
    const svg = await renderMermaidSvg({
      code: source.code,
      id: opts.renderId,
      theme: mermaidThemeFromApp(opts.appTheme),
    });
    return { status: "ready", title: source.title, svgHtml: prepareSvgHtml(svg) };
  } catch {
    return {
      status: "fallback",
      hint: `[图表：${chartTitle}]（Mermaid 静态渲染失败，请在应用内查看）`,
    };
  }
}

export async function hydrateShareImageTurns(
  turns: ShareImageTurn[],
  opts: { appTheme: string },
): Promise<HydratedShareTurn[]> {
  const out: HydratedShareTurn[] = [];
  let renderIndex = 0;

  const nextGraphic = async (source: ShareImageGraphicSource) => {
    const renderId = `share-graphic-${renderIndex}`;
    renderIndex += 1;
    return hydrateShareGraphic(source, { appTheme: opts.appTheme, renderId });
  };

  for (const turn of turns) {
    if (turn.kind === "user") {
      out.push(turn);
      continue;
    }
    if (turn.kind === "widget") {
      out.push({ kind: "widget", graphic: await nextGraphic(turn.source) });
      continue;
    }
    const parts: HydratedAssistantPart[] = [];
    for (const part of turn.parts) {
      if (part.kind === "md") {
        parts.push(part);
        continue;
      }
      parts.push({ kind: "graphic", graphic: await nextGraphic(part.source) });
    }
    out.push({ kind: "assistant", parts });
  }

  return out;
}
