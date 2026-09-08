export function flattenMessageKeys(input: unknown, prefix = ""): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return prefix ? [prefix] : [];
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) {
    return prefix ? [prefix] : [];
  }
  return entries.flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return flattenMessageKeys(value, path);
    }
    return [path];
  });
}
