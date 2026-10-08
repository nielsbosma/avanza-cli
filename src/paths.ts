import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

/** Every file the CLI keeps lives here. `AVANZA_CLI_HOME` overrides it (tests, multiple profiles). */
export function configDir(): string {
  return process.env.AVANZA_CLI_HOME ?? join(homedir(), ".config", "avanza-cli");
}

export function ensureConfigDir(): string {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export const paths = {
  session: () => join(configDir(), "session.json"),
  permissions: () => join(configDir(), "permissions.yaml"),
  config: () => join(configDir(), "config.yaml"),
  audit: () => join(configDir(), "audit.log"),
  credentialsFile: () => join(configDir(), "credentials.enc"),
};
