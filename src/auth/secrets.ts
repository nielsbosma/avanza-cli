import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { ensureConfigDir, paths } from "../paths.js";
import { CliError } from "../output/errors.js";

const SERVICE = "avanza-cli";

/** Keys kept in the secret store. */
export type SecretKey = "username" | "password" | "totp_secret" | "permissions_checksum";

export interface SecretStore {
  readonly kind: "keychain" | "file";
  get(key: SecretKey): string | undefined;
  set(key: SecretKey, value: string): void;
  delete(key: SecretKey): void;
}

class KeychainStore implements SecretStore {
  readonly kind = "keychain" as const;
  constructor(private readonly Entry: typeof import("@napi-rs/keyring").Entry) {}
  get(key: SecretKey) {
    try {
      return new this.Entry(SERVICE, key).getPassword() ?? undefined;
    } catch {
      return undefined;
    }
  }
  set(key: SecretKey, value: string) {
    new this.Entry(SERVICE, key).setPassword(value);
  }
  delete(key: SecretKey) {
    try {
      new this.Entry(SERVICE, key).deletePassword();
    } catch {
      /* already absent */
    }
  }
}

/** AES-256-GCM file, key derived with scrypt from AVANZA_CLI_PASSPHRASE. Used when no OS keychain is available. */
export class EncryptedFileStore implements SecretStore {
  readonly kind = "file" as const;
  constructor(private readonly passphrase: string) {}

  private read(): Record<string, string> {
    const file = paths.credentialsFile();
    if (!existsSync(file)) return {};
    const blob = JSON.parse(readFileSync(file, "utf8")) as { salt: string; iv: string; tag: string; data: string };
    const key = scryptSync(this.passphrase, Buffer.from(blob.salt, "base64"), 32);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(blob.iv, "base64"));
    decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
    try {
      const plain = Buffer.concat([decipher.update(Buffer.from(blob.data, "base64")), decipher.final()]);
      return JSON.parse(plain.toString("utf8"));
    } catch {
      throw new CliError("auth_failed", "Could not decrypt the credentials file.", "Check AVANZA_CLI_PASSPHRASE.");
    }
  }

  private write(values: Record<string, string>) {
    ensureConfigDir();
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(this.passphrase, salt, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(values), "utf8"), cipher.final()]);
    const blob = { salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
    writeFileSync(paths.credentialsFile(), JSON.stringify(blob), { mode: 0o600 });
  }

  get(key: SecretKey) {
    return this.read()[key];
  }
  set(key: SecretKey, value: string) {
    this.write({ ...this.read(), [key]: value });
  }
  delete(key: SecretKey) {
    const values = this.read();
    delete values[key];
    if (Object.keys(values).length === 0) rmSync(paths.credentialsFile(), { force: true });
    else this.write(values);
  }
}

let cached: SecretStore | undefined;

/** The OS keychain when it works; otherwise the encrypted file, which needs AVANZA_CLI_PASSPHRASE. */
export async function secretStore(): Promise<SecretStore> {
  if (cached) return cached;
  if (process.env.AVANZA_CLI_SECRET_STORE !== "file") {
    try {
      const { Entry } = await import("@napi-rs/keyring");
      const probe = new Entry(SERVICE, "__probe__");
      probe.setPassword("ok");
      probe.deletePassword();
      return (cached = new KeychainStore(Entry));
    } catch {
      /* fall through to the file store */
    }
  }
  const passphrase = process.env.AVANZA_CLI_PASSPHRASE;
  if (!passphrase) {
    throw new CliError("auth_missing", "No OS keychain is available and AVANZA_CLI_PASSPHRASE is not set.", "Set AVANZA_CLI_PASSPHRASE to use the encrypted credentials file.");
  }
  return (cached = new EncryptedFileStore(passphrase));
}

export function resetSecretStoreCache() {
  cached = undefined;
}
