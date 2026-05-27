const CITATION_VARIANTS: Array<{ pattern: RegExp; replace: (id: string) => string }> = [
  { pattern: /【(\d+)】/g, replace: (id) => `[${id}]` },
  { pattern: /\[来源\s*(\d+)\]/gi, replace: (id) => `[${id}]` },
  { pattern: /\(来源\s*(\d+)\)/g, replace: (id) => `[${id}]` },
];

export function normalizeCitationMarkers(text: string, enabled: boolean): string {
  if (!enabled || !text) return text;
  let next = text;
  for (const rule of CITATION_VARIANTS) {
    next = next.replace(rule.pattern, (_m, id: string) => rule.replace(String(id)));
  }
  return next;
}

export const CITATION_MARKER_RE = /\[(\d+)\]/g;

export function splitCitationSegments(text: string): Array<{ kind: "text" | "citation"; value: string }> {
  const parts = text.split(/(\[\d+\])/g).filter((part) => part.length > 0);
  return parts.map((part) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (match) return { kind: "citation" as const, value: match[1] };
    return { kind: "text" as const, value: part };
  });
}
