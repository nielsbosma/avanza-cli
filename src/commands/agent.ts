import type { Command } from "commander";
import { checkbox, confirm, input } from "@inquirer/prompts";
import { agentReadme } from "../agent/readme.js";
import { detectAgents } from "../agent/detectors/index.js";
import { install, uninstall } from "../agent/installers/index.js";
import { ensureConfigFile } from "../config.js";
import { emit } from "../output/format.js";
import { loadPermissions, savePermissions, type AccountPermission, type PermissionsFile } from "../policy/permissions.js";
import { getClient, requireTty } from "./context.js";
import { accountName } from "./mappers.js";

const sekLimit = async (message: string, current: number | undefined) => {
  const v = await input({
    message,
    default: current !== undefined ? String(current) : "",
    validate: (s) => s.trim() === "" || (Number.isFinite(Number(s)) && Number(s) >= 0) || "A number of SEK, or empty for no limit",
  });
  return v.trim() === "" ? undefined : { amount: Number(v), currency: "SEK" as const };
};

export function registerAgent(program: Command) {
  const agent = program.command("agent").description("Agent integration");

  agent
    .command("readme")
    .description("The full usage guide for agents (Markdown)")
    .action(() => {
      process.stdout.write(agentReadme(program));
    });

  agent
    .command("install")
    .description("Detect local agents and install the avanza pointer skill (human, TTY)")
    .option("--uninstall", "Remove the pointer skills instead")
    .action(async (opts: { uninstall?: boolean }) => {
      requireTty("agent install");
      const agents = detectAgents();
      const chosen = await checkbox({
        message: opts.uninstall ? "Remove the avanza skill from:" : "Install the avanza skill for:",
        choices: agents.map((a) => ({
          name: `${a.name}${a.detected ? ` (${a.reason})` : " (not detected)"}`,
          value: a.id,
          checked: a.detected && a.id !== "claude-desktop",
        })),
      });
      const results = chosen.map((id) => (opts.uninstall ? uninstall(id) : install(id)));
      emit("agent_install", { action: opts.uninstall ? "uninstall" : "install", results });
    });

  agent
    .command("permissions")
    .description("Choose per account what agents may read and trade, and the trading limits (human, TTY)")
    .action(async () => {
      requireTty("agent permissions");
      const current = await loadPermissions();
      const accounts = (await getClient().overview()).accounts;

      const label = (a: (typeof accounts)[number]) => `${accountName(a)} (${a.type}, ${a.id})`;
      const read = new Set(
        await checkbox({
          message: "Accounts agents may READ:",
          choices: accounts.map((a) => ({ name: label(a), value: a.id, checked: current.accounts[a.id]?.read ?? false })),
        }),
      );
      const trade = new Set(
        await checkbox({
          message: "Accounts agents may TRADE in (trade implies read):",
          choices: accounts.map((a) => ({ name: label(a), value: a.id, checked: current.accounts[a.id]?.trade ?? false })),
        }),
      );

      const next: PermissionsFile = { schema_version: 1, accounts: {} };
      for (const a of accounts) {
        const entry: AccountPermission = { name: accountName(a), read: read.has(a.id) || trade.has(a.id), trade: trade.has(a.id) };
        if (entry.trade) {
          const prev = current.accounts[a.id]?.limits;
          process.stderr.write(`\nLimits for ${label(a)}:\n`);
          const maxOrder = await sekLimit("Max value per order (SEK, empty = none):", prev?.max_order_value?.amount ?? 10000);
          const maxDaily = await sekLimit("Max value placed per day (SEK, empty = none):", prev?.max_daily_value?.amount ?? 25000);
          const sides = await checkbox({
            message: "Allowed sides:",
            choices: (["buy", "sell"] as const).map((s) => ({ name: s, value: s, checked: prev?.allowed_sides?.includes(s) ?? true })),
            required: true,
          });
          entry.limits = { max_order_value: maxOrder, max_daily_value: maxDaily, allowed_sides: sides };
        }
        if (entry.read) next.accounts[a.id] = entry;
      }

      const summary = Object.entries(next.accounts).map(([id, p]) => `  ${p.name} (${id}): ${p.trade ? "read + trade" : "read"}`);
      process.stderr.write(`\n${summary.length ? summary.join("\n") : "  No access to any account."}\n\n`);
      if (!(await confirm({ message: "Save these permissions?", default: true }))) {
        emit("agent_permissions", { status: "unchanged" });
        return;
      }
      await savePermissions(next);
      ensureConfigFile();
      emit("agent_permissions", { status: "saved", accounts: next.accounts });
    });
}
