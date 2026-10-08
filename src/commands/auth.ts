import type { Command } from "commander";
import { confirm, input, password } from "@inquirer/prompts";
import { AvanzaHttp } from "../client/http.js";
import { clearSession, loadSession } from "../auth/session.js";
import { secretStore } from "../auth/secrets.js";
import { isValidBase32, normaliseSecret, totpCode } from "../auth/totp.js";
import { ensureConfigFile } from "../config.js";
import { CliError } from "../output/errors.js";
import { emit } from "../output/format.js";
import { requireTty } from "./context.js";

const TERMS = `avanza-cli uses Avanza's private web API, which Avanza does not document or support.
Avanza's terms may not allow automated access, and the API can change without notice.
You use this tool, and any orders an agent places with it, at your own risk.`;

export function registerAuth(program: Command) {
  const auth = program.command("auth").description("Credentials and session (human)");

  auth
    .command("login")
    .description("Store username, password and TOTP secret in the OS keychain, after verifying them (human, TTY)")
    .action(async () => {
      requireTty("auth login");
      process.stderr.write(`\n${TERMS}\n\n`);
      if (!(await confirm({ message: "Do you accept this?", default: false }))) {
        throw new CliError("usage_error", "Terms not accepted; nothing was stored.");
      }
      const username = await input({ message: "Avanza username:", required: true });
      const pass = await password({ message: "Avanza password:", mask: "*" });
      process.stderr.write("TOTP secret: the base32 secret Avanza shows when you enable an authenticator app\n(in your Avanza login settings). Leave empty if your account has no TOTP.\n");
      const secretRaw = await password({ message: "TOTP secret:", mask: "*" });
      const totpSecret = secretRaw.trim() ? normaliseSecret(secretRaw) : undefined;
      if (totpSecret && !isValidBase32(totpSecret)) throw new CliError("usage_error", "That is not a base32 TOTP secret.");
      if (totpSecret) process.stderr.write(`Current code from that secret: ${totpCode(totpSecret)} (compare with your authenticator app)\n`);

      process.stderr.write("Verifying with Avanza…\n");
      const http = new AvanzaHttp();
      clearSession();
      await http.login({ username, password: pass, totpSecret, source: "store" });

      const store = await secretStore();
      store.set("username", username);
      store.set("password", pass);
      if (totpSecret) store.set("totp_secret", totpSecret);
      else store.delete("totp_secret");
      ensureConfigFile();
      emit("auth_login", { status: "ok", secret_store: store.kind, totp: !!totpSecret });
      process.stderr.write("\nStored. Next: `avanza agent permissions` to choose what agents may read and trade.\n");
    });

  auth
    .command("logout")
    .description("Remove stored credentials and session (human, TTY)")
    .action(async () => {
      requireTty("auth logout");
      const store = await secretStore();
      for (const k of ["username", "password", "totp_secret"] as const) store.delete(k);
      clearSession();
      emit("auth_logout", { status: "ok" });
    });

  auth
    .command("status")
    .description("Whether credentials exist and the session is valid (never prints secrets)")
    .action(async () => {
      const env = !!(process.env.AVANZA_USERNAME && process.env.AVANZA_PASSWORD);
      let stored = false;
      let storeKind: string | undefined;
      try {
        const store = await secretStore();
        storeKind = store.kind;
        stored = !!(store.get("username") && store.get("password"));
      } catch {
        /* no store available */
      }
      const session = loadSession();
      const valid = session ? await new AvanzaHttp().probeSession().catch(() => false) : false;
      emit("auth_status", {
        credentials: env ? "env" : stored ? "stored" : "none",
        secret_store: storeKind,
        session: valid ? "valid" : session ? "expired" : "none",
        session_created_at: session?.createdAt,
      });
    });
}
