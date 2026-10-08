import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AvanzaHttp } from "../../src/client/http.js";
import { CliError } from "../../src/output/errors.js";

type Handler = (url: URL, init: RequestInit) => Response;

function fakeFetch(handler: Handler) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = (async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const creds = async () => ({ username: "u", password: "p", totpSecret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", source: "env" as const });

beforeEach(() => {
  process.env.AVANZA_CLI_HOME = mkdtempSync(join(tmpdir(), "avz-"));
});

describe("AvanzaHttp", () => {
  it("logs in with password + TOTP, then sends the security token and cookies", async () => {
    let loggedIn = false;
    const { fn, calls } = fakeFetch((url, init) => {
      if (url.pathname.endsWith("/usercredentials")) return json({ twoFactorLogin: { method: "TOTP" } }, 200, { "Set-Cookie": "AZAMFA=1; Path=/" });
      if (url.pathname.endsWith("/totp")) {
        expect(JSON.parse(String(init.body)).totpCode).toMatch(/^\d{6}$/);
        loggedIn = true;
        return json({ customerId: "42" }, 200, { "X-SecurityToken": "tok", "Set-Cookie": "csid=abc; Path=/" });
      }
      const h = init.headers as Record<string, string>;
      expect(loggedIn).toBe(true);
      expect(h["X-SecurityToken"]).toBe("tok");
      expect(h.Cookie).toContain("csid=abc");
      return json({ ok: true });
    });
    const http = new AvanzaHttp({ credentials: creds, fetchImpl: fn });
    expect(await http.request("GET", "/x", z.object({ ok: z.boolean() }))).toEqual({ ok: true });
    expect(calls.map((c) => c.url.pathname)).toEqual(["/_api/authentication/sessions/usercredentials", "/_api/authentication/sessions/totp", "/x"]);
  });

  it("logs in again once on 401 and retries", async () => {
    let first = true;
    const { fn, calls } = fakeFetch((url) => {
      if (url.pathname.endsWith("/usercredentials")) return json({ successfulLogin: { customerId: "1" } }, 200, { "X-SecurityToken": "t" });
      if (first) {
        first = false;
        return new Response("", { status: 401 });
      }
      return json({ ok: true });
    });
    const http = new AvanzaHttp({ credentials: creds, fetchImpl: fn });
    await http.request("GET", "/x", z.object({ ok: z.boolean() }));
    expect(calls.filter((c) => c.url.pathname.endsWith("/usercredentials"))).toHaveLength(2);
  });

  it("returns auth_expired when the retry fails too", async () => {
    const { fn } = fakeFetch((url) =>
      url.pathname.endsWith("/usercredentials") ? json({ successfulLogin: {} }, 200, { "X-SecurityToken": "t" }) : new Response("", { status: 401 }),
    );
    const http = new AvanzaHttp({ credentials: creds, fetchImpl: fn });
    await expect(http.request("GET", "/x", z.any())).rejects.toMatchObject({ code: "auth_expired" });
  });

  it("reports schema_mismatch when Avanza changes a response", async () => {
    const { fn } = fakeFetch((url) =>
      url.pathname.endsWith("/usercredentials") ? json({ successfulLogin: {} }, 200, { "X-SecurityToken": "t" }) : json({ renamed: 1 }),
    );
    const http = new AvanzaHttp({ credentials: creds, fetchImpl: fn });
    const err = await http.request("GET", "/x", z.object({ ok: z.boolean() })).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.code).toBe("schema_mismatch");
  });

  it("refuses non-TOTP two-factor methods", async () => {
    const { fn } = fakeFetch(() => json({ twoFactorLogin: { method: "BANKID" } }));
    const http = new AvanzaHttp({ credentials: creds, fetchImpl: fn });
    await expect(http.login()).rejects.toMatchObject({ code: "auth_failed" });
  });
});
