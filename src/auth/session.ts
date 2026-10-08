import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { CookieJar } from "tough-cookie";
import { ensureConfigDir, paths } from "../paths.js";

export interface Session {
  jar: CookieJar;
  securityToken?: string;
  customerId?: string;
  createdAt?: string;
}

interface StoredSession {
  cookies: ReturnType<CookieJar["serializeSync"]>;
  securityToken?: string;
  customerId?: string;
  createdAt?: string;
}

export function loadSession(): Session | undefined {
  const file = paths.session();
  if (!existsSync(file)) return undefined;
  try {
    const stored = JSON.parse(readFileSync(file, "utf8")) as StoredSession;
    if (!stored.cookies) return undefined;
    return {
      jar: CookieJar.deserializeSync(stored.cookies),
      securityToken: stored.securityToken,
      customerId: stored.customerId,
      createdAt: stored.createdAt,
    };
  } catch {
    return undefined;
  }
}

export function saveSession(session: Session): void {
  ensureConfigDir();
  const stored: StoredSession = {
    cookies: session.jar.serializeSync(),
    securityToken: session.securityToken,
    customerId: session.customerId,
    createdAt: session.createdAt,
  };
  writeFileSync(paths.session(), JSON.stringify(stored), { mode: 0o600 });
}

export function clearSession(): void {
  rmSync(paths.session(), { force: true });
}
