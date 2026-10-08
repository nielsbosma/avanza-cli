import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { configDir } from "../../paths.js";
import type { AgentId } from "../detectors/index.js";
import { POINTER_SKILL } from "../skill.js";

export interface InstallResult {
  agent: AgentId;
  action: "installed" | "unchanged" | "removed" | "absent" | "manual";
  path: string;
  note?: string;
}

function writeIfChanged(file: string, content: string): "installed" | "unchanged" {
  if (existsSync(file) && readFileSync(file, "utf8") === content) return "unchanged";
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return "installed";
}

function removeDir(dir: string): "removed" | "absent" {
  if (!existsSync(dir)) return "absent";
  rmSync(dir, { recursive: true, force: true });
  return "removed";
}

const skillDirs: Record<Exclude<AgentId, "claude-desktop">, () => string> = {
  "claude-code": () => join(homedir(), ".claude", "skills", "avanza"),
  // Codex reads user skills from ~/.codex/skills/<name>/SKILL.md (verify on Codex upgrades).
  codex: () => join(homedir(), ".codex", "skills", "avanza"),
};

/** Claude Desktop has no skills folder to write into: the skill is prepared for manual upload. */
const desktopDir = () => join(configDir(), "claude-desktop", "avanza");

export function install(agent: AgentId): InstallResult {
  if (agent === "claude-desktop") {
    const file = join(desktopDir(), "SKILL.md");
    writeIfChanged(file, POINTER_SKILL);
    return {
      agent,
      action: "manual",
      path: file,
      note: "Claude Desktop skills are uploaded in the app (Settings → Capabilities → Skills). Upload this folder as a zip.",
    };
  }
  const file = join(skillDirs[agent](), "SKILL.md");
  return { agent, action: writeIfChanged(file, POINTER_SKILL), path: file };
}

export function uninstall(agent: AgentId): InstallResult {
  if (agent === "claude-desktop") {
    return { agent, action: removeDir(desktopDir()), path: desktopDir(), note: "Remove the skill in the Claude Desktop app too, if you uploaded it." };
  }
  const dir = skillDirs[agent]();
  return { agent, action: removeDir(dir), path: dir };
}
