import type { IxblixErrorBody } from "./types.js";

/**
 * Error thrown by the ixblix SDK when the API returns a non-2xx response or when
 * a request cannot be completed.
 */
export class IxblixError extends Error {
  /** HTTP status code returned by the API (0 when the request never reached it). */
  readonly status: number;
  /** Machine-readable ixblix error code (e.g. `UNAUTHORIZED`, `NOT_FOUND`). */
  readonly code: string;
  /** Optional validation error details. */
  readonly details?: Array<{ path: string; message: string }>;

  constructor(
    message: string,
    options: { status?: number; code?: string; details?: IxblixErrorBody["errors"] } = {},
  ) {
    super(message);
    this.name = "IxblixError";
    this.status = options.status ?? 0;
    this.code = options.code ?? "UNKNOWN";
    this.details = options.details;
  }
}
