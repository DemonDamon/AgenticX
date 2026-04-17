/**
 * 剪贴板中的纯文本，用于粘贴进 contentEditable 时避免带入 HTML 背景色/字体等样式。
 * 优先 `text/plain`；若无则从 `text/html` 解析为纯文本。
 */
export function clipboardPlainTextForPaste(data: DataTransfer | null): string {
  if (!data) return "";
  const plain = data.getData("text/plain");
  if (plain) return plain.replace(/\r\n/g, "\n");
  const html = data.getData("text/html");
  if (!html.trim()) return "";
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.body.textContent ?? "").replace(/\r\n/g, "\n");
  } catch {
    return "";
  }
}
