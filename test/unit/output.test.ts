import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { prune, render, renderError } from "../../src/output/format.js";
import { CliError, ExitCode } from "../../src/output/errors.js";
import { totpCode, isValidBase32 } from "../../src/auth/totp.js";

describe("output", () => {
  it("adds kind and schema_version and omits missing fields", () => {
    const doc = parse(render("holdings", { a: 1, b: undefined, c: null, d: { e: undefined }, f: [{ g: undefined, h: 2 }] }));
    expect(doc).toEqual({ kind: "holdings", schema_version: 1, a: 1, f: [{ h: 2 }] });
  });

  it("YAML and JSON carry the identical structure", () => {
    const body = { account_id: "1234567", holdings: [{ market_value: { amount: 1.5, currency: "SEK" } }] };
    expect(parse(render("holdings", body, "yaml"))).toEqual(JSON.parse(render("holdings", body, "json")));
  });

  it("keeps ids as strings", () => {
    expect(render("x", { account_id: "1234567" })).toContain('account_id: "1234567"');
  });

  it("renders structured errors with exit codes", () => {
    const err = new CliError("permission_denied", "Account 1 is not enabled for trading.", "Ask a human.");
    expect(err.exitCode).toBe(ExitCode.permission);
    expect(parse(renderError(err))).toEqual({
      kind: "error",
      schema_version: 1,
      error: { code: "permission_denied", message: "Account 1 is not enabled for trading.", hint: "Ask a human." },
    });
  });

  it("drops non-finite numbers", () => {
    expect(prune({ a: NaN, b: Infinity, c: 0 })).toEqual({ c: 0 });
  });
});

describe("totp", () => {
  // RFC 6238 appendix B, SHA1, secret "12345678901234567890" (base32 below); last 6 digits.
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  it.each([
    [59_000, "287082"],
    [1_111_111_109_000, "081804"],
    [1_234_567_890_000, "005924"],
    [2_000_000_000_000, "279037"],
  ])("generates the RFC 6238 code at %i", (t, expected) => {
    expect(totpCode(secret, t)).toBe(expected);
  });

  it("accepts secrets as Avanza shows them", () => {
    expect(isValidBase32("gezd gnbv gy3t qojq")).toBe(true);
    expect(isValidBase32("not-a-secret!")).toBe(false);
  });
});
