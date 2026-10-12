import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";


export function resolveCodexExecutable(): string {
  if (process.env.CODEX_COMMAND && process.env.CODEX_COMMAND.trim()) {
    return process.env.CODEX_COMMAND.trim();
  }
  if (process.env.AGENT_RUNNER_CODEX_COMMAND && process.env.AGENT_RUNNER_CODEX_COMMAND.trim()) {
    return process.env.AGENT_RUNNER_CODEX_COMMAND.trim();
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const localAppCandidate = join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe");
    if (existsSync(localAppCandidate)) {
      return localAppCandidate;
    }
  }

  const explicitUserCandidate = "C:\\Users\\hifia\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe";
  if (existsSync(explicitUserCandidate)) {
    return explicitUserCandidate;
  }

  const appData = process.env.APPDATA;
  if (appData) {
    const npmCandidate = join(appData, "npm", "codex.cmd");
    if (existsSync(npmCandidate)) {
      return npmCandidate;
    }
  }

  try {
    const lookupCmd = process.platform === "win32" ? "where.exe" : "which";
    const stdout = execFileSync(lookupCmd, ["codex"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const firstLine = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0);
    if (firstLine && existsSync(firstLine)) {
      return firstLine;
    }
  } catch {
    // Ignore error if lookup command fails or not found
  }

  return "codex";
}
