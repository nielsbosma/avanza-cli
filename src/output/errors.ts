/** Exit codes are part of the contract: see the spec's Output format section. */
export const ExitCode = {
  ok: 0,
  usage: 1,
  auth: 2,
  permission: 3,
  api: 4,
  rejected: 5,
} as const;

export type ErrorCode =
  | "usage_error"
  | "not_a_tty"
  | "auth_missing"
  | "auth_failed"
  | "auth_expired"
  | "permission_denied"
  | "trading_disabled"
  | "limit_exceeded"
  | "insufficient_buying_power"
  | "insufficient_holding"
  | "price_out_of_band"
  | "duplicate_order"
  | "not_tradable"
  | "not_found"
  | "avanza_api_error"
  | "schema_mismatch"
  | "order_rejected";

const exitFor: Record<ErrorCode, number> = {
  usage_error: ExitCode.usage,
  not_a_tty: ExitCode.usage,
  auth_missing: ExitCode.auth,
  auth_failed: ExitCode.auth,
  auth_expired: ExitCode.auth,
  permission_denied: ExitCode.permission,
  trading_disabled: ExitCode.permission,
  limit_exceeded: ExitCode.rejected,
  insufficient_buying_power: ExitCode.rejected,
  insufficient_holding: ExitCode.rejected,
  price_out_of_band: ExitCode.rejected,
  duplicate_order: ExitCode.rejected,
  not_tradable: ExitCode.rejected,
  not_found: ExitCode.usage,
  avanza_api_error: ExitCode.api,
  schema_mismatch: ExitCode.api,
  order_rejected: ExitCode.rejected,
};

export class CliError extends Error {
  readonly exitCode: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly hint?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.exitCode = exitFor[code];
  }
}

export const allErrorCodes = Object.keys(exitFor) as ErrorCode[];
export const exitCodeFor = (code: ErrorCode) => exitFor[code];
