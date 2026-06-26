import type { Message } from "../../store";

export type WidgetPayload = {
  title: string;
  widgetCode: string;
  loadingMessages: string[];
  /** "svg" when widgetCode starts with <svg, else "html". */
  kind: "svg" | "html";
};

function widgetKind(widgetCode: string): "svg" | "html" {
  return widgetCode.trimStart().toLowerCase().startsWith("<svg") ? "svg" : "html";
}

export function parseWidgetPayload(content: string): WidgetPayload | null {
  const raw = String(content ?? "").trim();
  if (!raw.startsWith("{") || !raw.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.type !== "widget") return null;
    const widgetCode = typeof parsed.widget_code === "string" ? parsed.widget_code : "";
    if (!widgetCode.trim()) return null;
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const rawMsgs = parsed.loading_messages;
    const loadingMessages = Array.isArray(rawMsgs)
      ? rawMsgs.map((m) => String(m ?? "").trim()).filter(Boolean)
      : [];
    return {
      title,
      widgetCode,
      loadingMessages,
      kind: widgetKind(widgetCode),
    };
  } catch {
    return null;
  }
}

export function isShowWidgetToolMessage(message: Message): boolean {
  return String(message.toolName ?? "").trim() === "show_widget";
}
