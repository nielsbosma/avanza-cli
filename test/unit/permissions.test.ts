import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSecretStoreCache } from "../../src/auth/secrets.js";
import { canRead, canTrade, loadPermissions, savePermissions } from "../../src/policy/permissions.js";
import { paths } from "../../src/paths.js";

beforeEach(() => {
  process.env.AVANZA_CLI_HOME = mkdtempSync(join(tmpdir(), "avz-"));
  process.env.AVANZA_CLI_SECRET_STORE = "file";
  process.env.AVANZA_CLI_PASSPHRASE = "test";
  resetSecretStoreCache();
});

describe("permissions", () => {
  it("default deny: no file grants nothing", async () => {
    const p = await loadPermissions();
    expect(canRead(p, "1234567")).toBe(false);
    expect(canTrade(p, "1234567")).toBe(false);
  });

  it("trade implies read, and a saved file round-trips without a warning", async () => {
    await savePermissions({ schema_version: 1, accounts: { "7654321": { name: "Sandbox", read: false, trade: true } } });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const p = await loadPermissions();
    expect(canRead(p, "7654321")).toBe(true);
    expect(canTrade(p, "7654321")).toBe(true);
    expect(canRead(p, "1234567")).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("warns on stderr when the file was edited by hand", async () => {
    await savePermissions({ schema_version: 1, accounts: {} });
    writeFileSync(paths.permissions(), 'schema_version: 1\naccounts:\n  "1": { read: true, trade: true }\n');
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await loadPermissions();
    expect(String(spy.mock.calls[0]?.[0])).toContain("modified outside");
    spy.mockRestore();
  });
});
