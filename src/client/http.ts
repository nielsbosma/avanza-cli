import { CookieJar } from "tough-cookie";
import type { z } from "zod";
import { CliError } from "../output/errors.js";
import { loadCredentials, type Credentials } from "../auth/credentials.js";
import { clearSession, loadSession, saveSession, type Session } from "../auth/session.js";
import { msToNextWindow, totpCode } from "../auth/totp.js";

export const BASE_URL = "https://www.avanza.se";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
/** Minimum spacing between requests: keeps the request rate low and human-like. */
const MIN_REQUEST_GAP_MS = 250;

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

/** Internal: a TOTP code was refused (usually reused inside its window). */
class TotpRejected extends Error {}

export interface HttpOptions {
  /** Credentials to log in with; defaults to env vars, then the secret store. */
  credentials?: () => Promise<Credentials | undefined>;
  /** Read and write ~/.config/avanza-cli/session.json (default true). */
  persist?: boolean;
  fetchImpl?: typeof fetch;
}

/**
 * Transport for Avanza's private web API: cookie jar, X-SecurityToken header,
 * session reuse across runs, and one silent re-login on 401.
 */
export class AvanzaHttp {
  private session: Session | undefined;
  private lastRequestAt = 0;

  constructor(private readonly opts: HttpOptions = {}) {}

  private get fetch() {
    return this.opts.fetchImpl ?? globalThis.fetch;
  }

  private async throttle() {
    const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
  }

  private async raw(session: Session, method: string, path: string, options: RequestOptions = {}): Promise<Response> {
    await this.throttle();
    const url = new URL(path, BASE_URL);
    for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
    };
    const cookie = await session.jar.getCookieString(url.toString());
    if (cookie) headers.Cookie = cookie;
    if (session.securityToken) headers["X-SecurityToken"] = session.securityToken;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await this.fetch(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: "manual",
      });
    } catch (e) {
      throw new CliError("avanza_api_error", `Could not reach Avanza: ${(e as Error).message}`);
    }
    for (const c of response.headers.getSetCookie?.() ?? []) {
      await session.jar.setCookie(c, url.toString(), { ignoreError: true });
    }
    const token = response.headers.get("x-securitytoken");
    if (token) session.securityToken = token;
    return response;
  }

  /** Full login: username and password, then a TOTP code if Avanza asks for one. */
  async login(credentials?: Credentials): Promise<Session> {
    const creds = credentials ?? (await this.opts.credentials?.()) ?? (await loadCredentials());
    if (!creds) {
      throw new CliError("auth_missing", "No Avanza credentials are stored.", "A human must run `avanza auth login` first.");
    }

    const attempt = async (): Promise<Session> => {
      const session: Session = { jar: new CookieJar(), createdAt: new Date().toISOString() };
      const res = await this.raw(session, "POST", "/_api/authentication/sessions/usercredentials", {
        body: { username: creds.username, password: creds.password, maxInactiveMinutes: 60 * 24 },
      });
      if (res.status === 401) throw new CliError("auth_failed", "Avanza rejected the username or password.");
      if (!res.ok) throw new CliError("avanza_api_error", `Login failed with HTTP ${res.status}.`);
      const body = (await res.json()) as {
        twoFactorLogin?: { method?: string };
        successfulLogin?: { customerId?: string };
      };

      if (!body.twoFactorLogin) {
        session.customerId = body.successfulLogin?.customerId;
        return session;
      }
      if (body.twoFactorLogin.method !== "TOTP") {
        throw new CliError(
          "auth_failed",
          `Avanza asked for two-factor method ${body.twoFactorLogin.method}; only TOTP is supported.`,
          "Enable an authenticator app (TOTP) in Avanza's settings.",
        );
      }
      if (!creds.totpSecret) {
        throw new CliError("auth_missing", "Avanza requires TOTP but no TOTP secret is stored.", "A human must run `avanza auth login`.");
      }
      const totp = await this.raw(session, "POST", "/_api/authentication/sessions/totp", {
        body: { method: "TOTP", totpCode: totpCode(creds.totpSecret) },
      });
      if (totp.status === 401) throw new TotpRejected();
      if (!totp.ok) throw new CliError("avanza_api_error", `TOTP step failed with HTTP ${totp.status}.`);
      const tb = (await totp.json()) as { customerId?: string };
      session.customerId = tb.customerId;
      if (!session.securityToken) throw new CliError("auth_failed", "Avanza did not return a security token.");
      return session;
    };

    let session: Session;
    try {
      session = await attempt();
    } catch (e) {
      // A code already used inside its 30 s window is refused: wait for the next window, once.
      if (!(e instanceof TotpRejected)) throw e;
      process.stderr.write("warning: TOTP code refused; retrying with the next code\n");
      await new Promise((r) => setTimeout(r, msToNextWindow() + 500));
      try {
        session = await attempt();
      } catch (e2) {
        if (e2 instanceof TotpRejected) {
          throw new CliError("auth_failed", "Avanza rejected the TOTP code.", "Check the TOTP secret with `avanza auth login`.");
        }
        throw e2;
      }
    }
    this.session = session;
    if (this.opts.persist !== false) saveSession(session);
    return session;
  }

  private async currentSession(): Promise<Session> {
    if (this.session) return this.session;
    const stored = this.opts.persist === false ? undefined : loadSession();
    return (this.session = stored ?? (await this.login()));
  }

  /** Is there a stored session Avanza still accepts? Never logs in. */
  async probeSession(): Promise<boolean> {
    const stored = loadSession();
    if (!stored) return false;
    const res = await this.raw(stored, "GET", "/_api/account-overview/overview/categorizedAccounts");
    return res.ok;
  }

  async request<T>(method: string, path: string, schema: z.ZodType<T>, options: RequestOptions = {}): Promise<T> {
    let session = await this.currentSession();
    let res = await this.raw(session, method, path, options);
    if (res.status === 401 || res.status === 403) {
      clearSession();
      this.session = undefined;
      session = await this.login();
      res = await this.raw(session, method, path, options);
      if (res.status === 401 || res.status === 403) {
        throw new CliError(
          "auth_expired",
          "The Avanza session expired and logging in again did not help.",
          "A human should run `avanza auth status`, then `avanza auth login`.",
        );
      }
    }
    if (this.opts.persist !== false) saveSession(session);
    const text = await res.text();
    if (!res.ok) {
      throw new CliError("avanza_api_error", `Avanza returned HTTP ${res.status} for ${method} ${path}.`, undefined, {
        status: res.status,
        body: text.slice(0, 500),
      });
    }
    let json: unknown = null;
    try {
      json = text.length ? JSON.parse(text) : null;
    } catch {
      throw new CliError("schema_mismatch", `Avanza returned non-JSON for ${path}.`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new CliError(
        "schema_mismatch",
        `Avanza's response for ${path} did not match the expected shape; the endpoint may have changed.`,
        "Report this: the CLI needs an update.",
        { issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) },
      );
    }
    return parsed.data;
  }
}
