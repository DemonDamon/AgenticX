import {
  selectDirectPageEvidence,
  type DirectPageEvidence,
  type DirectPageMessage,
  type DirectPageView,
} from "../web-search/direct-page";
import {
  documentTitleEntity,
  resolveSpecifiedDocumentResearchQuery,
} from "./direct-document-intent";

const ATTACHMENT_HEADER =
  /^---[ \t]*(?:附件|attachment)[ \t]*[:：][ \t]*(.*?)[ \t]*---[ \t]*$/gimu;
const MAX_ATTACHMENT_NAME_CHARS = 180;

export type AttachedDocument = {
  identity: string;
  fileName: string;
  title: string;
  text: string;
};

export type AttachedDocumentReference = {
  documents: AttachedDocument[];
  question: string;
  explicitInCurrentTurn: boolean;
};

function messageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const row = part as { type?: unknown; text?: unknown };
      return row.type === "text" && typeof row.text === "string" ? [row.text.trim()] : [];
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function safeFileName(raw: string): string {
  const normalized = raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "未命名文件";
  return normalized.slice(0, MAX_ATTACHMENT_NAME_CHARS);
}

function fileStem(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]{1,12}$/u, "").trim();
  return withoutExtension || fileName;
}

function compactLine(raw: string): string {
  return raw
    .replace(/^\s{0,3}#{1,6}\s*/u, "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NON_TITLE_LINE = /^(?:摘要|关键词|目录|内容|abstract|keywords?|contents?|table of contents|page\s*\d+|第?\s*\d+\s*页)$/iu;

/** Conservative title extraction: parsed PDF first line, then caller uses filename. */
export function inferAttachedDocumentTitle(text: string, fileName: string): string {
  const stem = fileStem(fileName).toLocaleLowerCase();
  for (const rawLine of text.split("\n").slice(0, 24)) {
    const line = compactLine(rawLine);
    if (line.length < 4 || line.length > 180) continue;
    if (NON_TITLE_LINE.test(line) || /^https?:\/\//iu.test(line) || /^\d+$/u.test(line)) {
      continue;
    }
    if (line.toLocaleLowerCase() === stem) continue;
    return line;
  }
  return "";
}

function stableTextHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function parseAttachmentTurn(content: unknown): {
  question: string;
  documents: AttachedDocument[];
} {
  const text = messageText(content).replace(/\r\n/g, "\n");
  const matches = [...text.matchAll(ATTACHMENT_HEADER)];
  if (matches.length === 0) return { question: text.trim(), documents: [] };

  const documents: AttachedDocument[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const bodyStart = (match.index ?? 0) + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? text.length;
    const body = text.slice(bodyStart, bodyEnd).trim();
    if (!body) continue;
    const fileName = safeFileName(match[1] ?? "");
    documents.push({
      identity: `${fileName.toLocaleLowerCase()}:${stableTextHash(body)}`,
      fileName,
      title: inferAttachedDocumentTitle(body, fileName),
      text: body,
    });
  }
  const firstHeader = matches[0]?.index ?? text.length;
  return { question: text.slice(0, firstHeader).trim(), documents };
}

export function extractAttachedDocumentQuestion(content: unknown): string {
  return parseAttachmentTurn(content).question;
}

/** Resolve current uploads, otherwise a unique previously uploaded document. */
export function resolveAttachedDocumentReference(
  messages: DirectPageMessage[],
): AttachedDocumentReference | null {
  let currentUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      currentUserIndex = index;
      break;
    }
  }
  if (currentUserIndex < 0) return null;

  const current = parseAttachmentTurn(messages[currentUserIndex]?.content);
  if (current.documents.length > 0) {
    return {
      documents: current.documents,
      question: current.question,
      explicitInCurrentTurn: true,
    };
  }

  const historical = new Map<string, AttachedDocument>();
  for (let index = currentUserIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== "user") continue;
    for (const document of parseAttachmentTurn(messages[index]?.content).documents) {
      if (!historical.has(document.identity)) historical.set(document.identity, document);
    }
  }
  if (historical.size !== 1) return null;
  const document = historical.values().next().value;
  if (!document) return null;
  return {
    documents: [document],
    question: current.question,
    explicitInCurrentTurn: false,
  };
}

function attachedDocumentEntity(reference: AttachedDocumentReference): string {
  if (reference.documents.length === 1) {
    const document = reference.documents[0]!;
    return documentTitleEntity(document.title) || `文件《${document.fileName}》`;
  }
  const labels = reference.documents
    .slice(0, 3)
    .map((document) => document.title || document.fileName)
    .join("、");
  const remainder = reference.documents.length > 3 ? "等" : "";
  return `上传的 ${reference.documents.length} 个文件（${labels}${remainder}）`;
}

export function resolveAttachedDocumentResearchQuery(
  reference: AttachedDocumentReference,
): string {
  return resolveSpecifiedDocumentResearchQuery(
    reference.question,
    attachedDocumentEntity(reference),
  );
}

export function attachedDocumentCitationUrl(document: AttachedDocument): string {
  return `attachment:${encodeURIComponent(document.identity)}`;
}

/** Reuse the same BM25 passage selector as explicit public-page reading. */
export function selectAttachedDocumentEvidence(
  document: AttachedDocument,
  queries: string[],
  maxChars = 12_000,
): DirectPageEvidence {
  const url = attachedDocumentCitationUrl(document);
  const view: DirectPageView = {
    reference: {
      adapterId: "public-web",
      identity: document.identity,
      readUrl: url,
      displayUrl: url,
      question: "",
      explicitInCurrentTurn: true,
    },
    title: document.title || document.fileName,
    text: document.text,
    rawChars: document.text.length,
    coverage: "full_html",
    backend: "native",
  };
  return selectDirectPageEvidence(view, queries, maxChars);
}
