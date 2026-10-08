/** Library entry: the typed Avanza client and the policy layer, without the CLI. */
export * from "./client/index.js";
export { loadCredentials, type Credentials } from "./auth/credentials.js";
export { totpCode } from "./auth/totp.js";
export { checkOrder, idempotencyKey, type CheckedOrder, type OrderContext, type OrderInput } from "./policy/limits.js";
export { loadPermissions, canRead, canTrade, type PermissionsFile, type AccountPermission, type Limits } from "./policy/permissions.js";
export { CliError, ExitCode, type ErrorCode } from "./output/errors.js";
export { VERSION } from "./version.js";
