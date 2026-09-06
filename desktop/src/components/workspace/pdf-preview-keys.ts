export function pdfNavDeltaFromKey(key: string): -1 | 1 | 0 {
  if (key === "ArrowLeft" || key === "ArrowUp") return -1;
  if (key === "ArrowRight" || key === "ArrowDown") return 1;
  return 0;
}
