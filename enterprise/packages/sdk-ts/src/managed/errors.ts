export class MaApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | null;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown> | null) {
    super(message);
    this.name = "MaApiError";
    this.status = status;
    this.code = code;
    this.details = details ?? null;
  }
}
