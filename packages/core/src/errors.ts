export type HilvanaErrorCode =
  | 'EMPTY_DOCUMENT'
  | 'INVALID_RANGE'
  | 'PAGE_OUT_OF_RANGE'
  | 'NO_INPUTS'
  | 'ENCRYPTED'
  | 'PASSWORD_REQUIRED'
  | 'WRONG_PASSWORD'
  | 'INVALID_CERTIFICATE'
  | 'WRONG_CERTIFICATE_PASSWORD'
  | 'CERTIFICATE_EXPIRED'
  | 'CERTIFICATE_NOT_YET_VALID'
  | 'INVALID_PDF'
  | 'UNSUPPORTED_IMAGE'
  | 'WOULD_REMOVE_ALL_PAGES'
  | 'INVALID_ARGUMENT'
  | 'UNSUPPORTED_CHARACTERS';

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
