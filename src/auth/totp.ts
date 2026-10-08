import { Secret, TOTP } from "otpauth";

/** Normalises a base32 TOTP secret as Avanza shows it (spaces, lower case). */
export const normaliseSecret = (secret: string) => secret.replace(/\s+/g, "").toUpperCase();

export function totpCode(secret: string, timestamp = Date.now()): string {
  const totp = new TOTP({ secret: Secret.fromBase32(normaliseSecret(secret)), digits: 6, period: 30, algorithm: "SHA1" });
  return totp.generate({ timestamp });
}

/** Milliseconds until the next 30 s TOTP window. */
export const msToNextWindow = (now = Date.now()) => 30_000 - (now % 30_000);

export function isValidBase32(secret: string): boolean {
  return /^[A-Z2-7]+=*$/.test(normaliseSecret(secret)) && normaliseSecret(secret).length >= 16;
}
