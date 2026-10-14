const DEFAULT_GATEWAY_INTERNAL_BASE = "http://127.0.0.1:8088";

export function gatewayInternalBase(): string {
  const raw =
    process.env.GATEWAY_INTERNAL_BASE_URL?.trim() ||
    process.env.GATEWAY_INTERNAL_URL?.trim() ||
    DEFAULT_GATEWAY_INTERNAL_BASE;
  return raw.replace(/\/+$/, "");
}
