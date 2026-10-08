import { Command, CommanderError, Option } from "commander";
import { registerAccounts } from "./commands/accounts.js";
import { registerAgent } from "./commands/agent.js";
import { registerAuth } from "./commands/auth.js";
import { registerHoldings } from "./commands/holdings.js";
import { registerInstruments } from "./commands/instruments.js";
import { registerOrders } from "./commands/orders.js";
import { registerTransactions } from "./commands/transactions.js";
import { agentMeta } from "./commands/meta.js";
import { loadConfig } from "./config.js";
import { appendAudit } from "./policy/audit.js";
import { CliError, ExitCode } from "./output/errors.js";
import { renderError, setOutputFormat } from "./output/format.js";
import { VERSION } from "./version.js";

export function buildProgram(): Command {
  const program = new Command()
    .name("avanza")
    .description("Agent-first CLI for Avanza. Agents: run `avanza agent readme` first.")
    .version(VERSION)
    .addOption(new Option("--json", "Output JSON instead of YAML"))
    .showHelpAfterError(false)
    .exitOverride()
    .configureOutput({ writeErr: (s) => process.stderr.write(s) })
    .hook("preAction", (_root, cmd) => {
      setOutputFormat(cmd.optsWithGlobals().json ? "json" : "yaml");
    })
    .hook("postAction", (_root, cmd) => {
      const meta = agentMeta(cmd);
      if (meta && !meta.trades && loadConfig().audit_reads) {
        appendAudit({ command: `${cmd.parent?.name()} ${cmd.name()}`, result: "read", message: cmd.args.join(" ") || undefined });
      }
    });

  registerAuth(program);
  registerAgent(program);
  registerAccounts(program);
  registerHoldings(program);
  registerInstruments(program);
  registerTransactions(program);
  registerOrders(program);
  return program;
}

/** Runs the CLI and returns the exit code. Every failure becomes a structured error document on stdout. */
export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--json")) setOutputFormat("json");
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
    return ExitCode.ok;
  } catch (e) {
    if (e instanceof CommanderError) {
      if (e.code === "commander.helpDisplayed" || e.code === "commander.version" || e.code === "commander.help") return ExitCode.ok;
      process.stdout.write(renderError(new CliError("usage_error", e.message.replace(/^error: /, ""), "Run `avanza agent readme` for usage.")));
      return ExitCode.usage;
    }
    if (e instanceof CliError) {
      process.stdout.write(renderError(e));
      return e.exitCode;
    }
    if (e instanceof Error && e.name === "ExitPromptError") {
      process.stdout.write(renderError(new CliError("usage_error", "Cancelled.")));
      return ExitCode.usage;
    }
    process.stdout.write(renderError(new CliError("avanza_api_error", `Unexpected error: ${(e as Error).message ?? String(e)}`)));
    return ExitCode.api;
  }
}
