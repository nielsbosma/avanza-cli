import type { Command, Option } from "commander";
import { agentMeta } from "../commands/meta.js";
import { allErrorCodes, exitCodeFor } from "../output/errors.js";
import { ConfigSchema } from "../config.js";
import { VERSION } from "../version.js";

const path = (cmd: Command): string => {
  const names: string[] = [];
  for (let c: Command | null = cmd; c && c.parent; c = c.parent) names.unshift(c.name());
  return names.join(" ");
};

function* walk(cmd: Command): Generator<Command> {
  for (const c of cmd.commands) {
    yield c;
    yield* walk(c);
  }
}

function usage(cmd: Command): string {
  const args = cmd.registeredArguments.map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}]`));
  const opts = cmd.options.filter((o) => !o.hidden).map((o: Option) => (o.mandatory ? o.flags : `[${o.flags}]`));
  return ["avanza", path(cmd), ...args, ...opts].join(" ");
}

function optionLines(cmd: Command): string[] {
  const lines: string[] = [];
  for (const a of cmd.registeredArguments) lines.push(`- \`<${a.name()}>\`: ${a.description}`);
  for (const o of cmd.options) {
    let line = `- \`${o.flags}\`: ${o.description}`;
    if (o.mandatory) line += " (required)";
    if (o.argChoices) line += ` One of: ${o.argChoices.join(", ")}.`;
    if (o.defaultValue !== undefined && typeof o.defaultValue !== "boolean") line += ` Default: ${o.defaultValue}.`;
    lines.push(line);
  }
  return lines;
}

/** The agent usage guide, generated from the same command definitions the CLI runs on. */
export function agentReadme(program: Command): string {
  const commands = [...walk(program)].filter((c) => agentMeta(c));
  const defaults = ConfigSchema.parse({});
  const out: string[] = [];

  out.push(`# avanza CLI — agent guide (v${VERSION})`, "");
  out.push(
    "The `avanza` CLI reads a human's Avanza (Swedish broker) accounts and can place limit orders.",
    "You act inside limits the human set. The human controls credentials and permissions; you do not.",
    "",
    "## Your limits",
    "",
    "- You only see accounts the human granted **read** on. Other accounts do not exist for you.",
    "- You can only trade in accounts with **trade** permission, within per-account limits (`max_order_value`, `max_daily_value`, `allowed_sides`).",
    "- `avanza auth …`, `avanza agent install` and `avanza agent permissions` are human commands; they refuse to run without a terminal. Never try to run them, and never edit files in `~/.config/avanza-cli/`.",
    `- A global kill switch may disable all trading. Orders priced more than ±${defaults.price_band_percent}% (default) from the last price are refused. An identical order within ${defaults.duplicate_window_seconds} s (default) is refused.`,
    "- Only limit orders on listed instruments (stocks, ETFs, certificates). No market orders, no fund orders, no stop-loss.",
    "",
    "## Rules",
    "",
    "1. **Always preview before trading**: run the order with `--dry-run`, show the human the preview, and place it only when the human has asked for that trade.",
    "2. **Never retry a rejected or refused order blindly.** Read the error, report it to the human.",
    "3. **Report `permission_denied` to the human** instead of working around it (other account, smaller orders to slip under limits, etc.).",
    "4. After placing an order, **confirm it with `avanza orders list`**.",
    "5. Use `--json` if you prefer JSON; the structure is identical.",
    "",
    "## Workflow: buying or selling",
    "",
    "1. Find the instrument: `avanza instruments search \"<name or ticker>\"` → note `orderbook_id`.",
    "2. Check the quote: `avanza instruments show <orderbook_id>`.",
    "3. Check holdings and buying power: `avanza accounts list`, `avanza holdings list --account <id>`.",
    "4. Preview: `avanza orders buy --account <id> --orderbook <orderbook_id> --volume <n> --price <p> --dry-run`.",
    "5. Place: the same command without `--dry-run`.",
    "6. Confirm: `avanza orders list --account <id>`. Cancel with `avanza orders cancel --account <id> --order <order_id>` if needed.",
    "",
    "## Output",
    "",
    "- Every command prints one YAML document on stdout (`--json` for JSON). Warnings go to stderr.",
    "- Every document has top-level `kind` and `schema_version` (currently 1).",
    "- Keys are snake_case and stable. Money is `{ amount, currency }`. Percentages are plain numbers (`4.2` = 4.2 %). Dates are ISO 8601.",
    "- Fields Avanza does not provide for an instrument are omitted, never null.",
    "",
    "## Errors",
    "",
    "Errors are printed on stdout as a document with a non-zero exit code:",
    "",
    "```yaml",
    "kind: error",
    "schema_version: 1",
    "error:",
    "  code: permission_denied",
    "  message: Account 1234567 is not enabled for trading.",
    "  hint: A human can grant it with `avanza agent permissions`.",
    "```",
    "",
    "Exit codes: `0` success, `1` usage error, `2` auth error, `3` permission denied, `4` Avanza API error, `5` order rejected.",
    "",
    "| code | exit |",
    "|---|---|",
    ...allErrorCodes.map((c) => `| \`${c}\` | ${exitCodeFor(c)} |`),
    "",
    "`auth_missing` / `auth_expired`: tell the human to run `avanza auth login`. `schema_mismatch`: Avanza changed its API; tell the human the CLI needs an update.",
    "",
    "## Commands",
    "",
  );

  for (const cmd of commands) {
    const meta = agentMeta(cmd)!;
    out.push(`### \`avanza ${path(cmd)}\``, "", cmd.description(), "");
    if (meta.trades) out.push("**Places or cancels real orders with real money** unless `--dry-run` is given.", "");
    out.push("```", usage(cmd), "```", "");
    const lines = optionLines(cmd);
    if (lines.length) out.push(...lines, "");
    out.push(`Output kind: \`${meta.kind}\`. Example (illustrative values):`, "", "```yaml", meta.example, "```", "");
  }

  out.push("## Global options", "", "- `--json`: JSON instead of YAML.", "- `--version`: the CLI version. This guide is for v" + VERSION + "; re-read it if the version changes.", "");
  return out.join("\n");
}
