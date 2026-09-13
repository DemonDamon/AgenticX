export function pptxNavDeltaFromKey(key: string): -1 | 1 | 0 {
  if (key === "ArrowLeft") return -1;
  if (key === "ArrowRight") return 1;
  return 0;
}
