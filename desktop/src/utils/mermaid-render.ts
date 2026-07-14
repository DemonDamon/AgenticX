import mermaid from "mermaid";

export type MermaidRenderTheme = "dark" | "default";

export async function renderMermaidSvg(args: {
  code: string;
  id: string;
  theme: MermaidRenderTheme;
}): Promise<string> {
  const code = args.code.trim();
  if (!code) throw new Error("Mermaid source is empty.");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: args.theme,
  });
  const { svg } = await mermaid.render(args.id, code);
  return svg;
}

export function mermaidThemeFromApp(appTheme: string): MermaidRenderTheme {
  return appTheme === "light" ? "default" : "dark";
}
