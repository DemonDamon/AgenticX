export function detectWakeword(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized.includes("hey jarvis") || normalized.includes("嘿jarvis");
}
