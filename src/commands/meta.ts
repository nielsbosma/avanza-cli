import type { Command } from "commander";

/** What `agent readme` needs to know about an agent command beyond commander's own definition. */
export interface AgentMeta {
  /** The `kind` of the YAML document it prints. */
  kind: string;
  example: string;
  /** Trading commands get a warning line in the readme. */
  trades?: boolean;
}

const registry = new WeakMap<Command, AgentMeta>();

export function agentCommand(cmd: Command, meta: AgentMeta): Command {
  registry.set(cmd, meta);
  return cmd;
}

export const agentMeta = (cmd: Command) => registry.get(cmd);
