export type HilvanaErrorCode =
  | 'EMPTY_DOCUMENT'
  | 'INVALID_RANGE'
  | 'PAGE_OUT_OF_RANGE'
  | 'NO_INPUTS'
  | 'ENCRYPTED'
  | 'INVALID_PDF'
  | 'UNSUPPORTED_IMAGE'
  | 'WOULD_REMOVE_ALL_PAGES'
  | 'INVALID_ARGUMENT';

/** Error with a stable code so every surface (web, CLI, MCP) can localize it. */
export class HilvanaError extends Error {
  readonly code: HilvanaErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: HilvanaErrorCode, details: Record<string, unknown> = {}) {
    super(`${code} ${JSON.stringify(details)}`);
    this.name = 'HilvanaError';
    this.code = code;
    this.details = details;
  }
}
