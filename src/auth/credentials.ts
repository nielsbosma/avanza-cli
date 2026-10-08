import { secretStore } from "./secrets.js";

export interface Credentials {
  username: string;
  password: string;
  totpSecret?: string;
  source: "env" | "store";
}

/** Environment variables win (headless use); otherwise the secret store from `avanza auth login`. */
export async function loadCredentials(): Promise<Credentials | undefined> {
  const { AVANZA_USERNAME, AVANZA_PASSWORD, AVANZA_TOTP_SECRET } = process.env;
  if (AVANZA_USERNAME && AVANZA_PASSWORD) {
    return { username: AVANZA_USERNAME, password: AVANZA_PASSWORD, totpSecret: AVANZA_TOTP_SECRET || undefined, source: "env" };
  }
  const store = await secretStore();
  const username = store.get("username");
  const password = store.get("password");
  if (!username || !password) return undefined;
  return { username, password, totpSecret: store.get("totp_secret"), source: "store" };
}
