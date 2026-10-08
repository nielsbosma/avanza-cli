import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, join } from "node:path";

/** Is an executable on PATH (with Windows extensions)? */
export function onPath(name: string): boolean {
  const exts = platform() === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").concat("") : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) if (existsSync(join(dir, name + ext.toLowerCase())) || existsSync(join(dir, name + ext))) return true;
  }
  return false;
}

export type AgentId = "claude-code" | "codex" | "claude-desktop";

export interface DetectedAgent {
  id: AgentId;
  name: string;
  detected: boolean;
  reason?: string;
}

export function claudeDesktopConfigDir(): string {
  const home = homedir();
  if (platform() === "darwin") return join(home, "Library", "Application Support", "Claude");
  if (platform() === "win32") return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Claude");
  return join(home, ".config", "Claude");
}

export function detectAgents(): DetectedAgent[] {
  const home = homedir();
  const claude = onPath("claude") ? "claude on PATH" : existsSync(join(home, ".claude")) ? "~/.claude exists" : undefined;
  const codex = onPath("codex") ? "codex on PATH" : existsSync(join(home, ".codex")) ? "~/.codex exists" : undefined;
  const desktop = existsSync(claudeDesktopConfigDir()) ? "app config dir exists" : undefined;
  return [
    { id: "claude-code", name: "Claude Code", detected: !!claude, reason: claude },
    { id: "codex", name: "Codex CLI", detected: !!codex, reason: codex },
    { id: "claude-desktop", name: "Claude Desktop", detected: !!desktop, reason: desktop },
  ];
}
