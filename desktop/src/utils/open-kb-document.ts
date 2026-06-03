import type { SearchReference } from "../types/search-references";
import { useAppStore } from "../store";
import {
  failKbDocumentOpenOverlay,
  finishKbDocumentOpenOverlay,
  showKbDocumentOpenOverlay,
  updateKbDocumentOpenOverlay,
} from "./kb-document-open-overlay";
import { parseKbReferenceUrl } from "./open-kb-reference";

type KbDocumentRow = {
  id: string;
  source_path: string;
  source_name?: string;
};

async function resolveStudioApiBase(): Promise<string> {
  const fromStore = String(useAppStore.getState().apiBase ?? "").trim();
  if (fromStore) return fromStore.replace(/\/+$/, "");
  const raw = String((await window.agenticxDesktop.getApiBase()) || "").trim();
  return raw.replace(/\/+$/, "");
}

async function fetchKbDocument(docId: string): Promise<KbDocumentRow> {
  const base = await resolveStudioApiBase();
  if (!base) throw new Error("本地服务未就绪，请稍后重试");
  const token = String(useAppStore.getState().apiToken ?? "").trim();
  const headers: Record<string, string> = {};
  if (token) headers["x-agx-desktop-token"] = token;
  const res = await fetch(`${base}/api/kb/documents/${encodeURIComponent(docId)}`, { headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = String(body?.detail ?? body?.error ?? detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { document?: KbDocumentRow };
  const doc = body.document;
  if (!doc?.id || !String(doc.source_path ?? "").trim()) {
    throw new Error("文档不存在或缺少本地路径");
  }
  return doc;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Resolve KB doc and open with the OS default app (ima-style), with loading overlay. */
export async function openKbDocumentFromReference(ref: SearchReference): Promise<void> {
  const parsed = parseKbReferenceUrl(ref.url);
  const docId = parsed?.docId?.trim();
  const title = String(ref.title || docId || "知识库文档").trim();
  if (!docId) {
    failKbDocumentOpenOverlay("无法解析知识库文档 ID");
    return;
  }

  showKbDocumentOpenOverlay(title, 8);
  try {
    updateKbDocumentOpenOverlay(22);
    const doc = await fetchKbDocument(docId);
    updateKbDocumentOpenOverlay(58, doc.source_name || title);
    await sleep(80);
    updateKbDocumentOpenOverlay(82);
    const opened = await window.agenticxDesktop.shellOpenPath(String(doc.source_path).trim());
    if (!opened.ok) {
      throw new Error(opened.error || "无法用系统默认应用打开该文件");
    }
    updateKbDocumentOpenOverlay(100);
    finishKbDocumentOpenOverlay();
  } catch (err) {
    failKbDocumentOpenOverlay(err instanceof Error ? err.message : String(err));
  }
}
