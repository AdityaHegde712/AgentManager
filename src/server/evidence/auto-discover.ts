import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);


export type DiscoveredStateDocument = {
  path: string;
  content: string;
};


export type AutoDiscoveredEvidence = {
  handoff?: string;
  stateDocuments: DiscoveredStateDocument[];
  gitStatus?: string;
};


export type AutoDiscoverOptions = {
  execFileFn?: (
    file: string,
    args: string[],
    options: { cwd: string; encoding: string; windowsHide?: boolean },
  ) => Promise<{ stdout: string; stderr: string }>;
};


export async function autoDiscoverProjectEvidence(
  projectRoot: string,
  options?: AutoDiscoverOptions,
): Promise<AutoDiscoveredEvidence> {
  let handoff: string | undefined;
  try {
    const handoffPath = join(projectRoot, "HANDOFF.md");
    handoff = await readFile(handoffPath, "utf-8");
  } catch {
    // HANDOFF.md is optional
  }

  const stateDocuments: DiscoveredStateDocument[] = [];
  const tasksDir = join(projectRoot, ".agent-tasks");
  try {
    const tasksStat = await stat(tasksDir);
    if (tasksStat.isDirectory()) {
      const taskFiles = ["PLAN.md", "DECISIONS.md", "TASKS.md"];
      for (const fileName of taskFiles) {
        try {
          const content = await readFile(join(tasksDir, fileName), "utf-8");
          stateDocuments.push({
            path: `.agent-tasks/${fileName}`,
            content,
          });
        } catch {
          // File does not exist, continue
        }
      }

      if (stateDocuments.length === 0) {
        // Look in immediate subdirectories (e.g. sprint-1)
        const entries = await readdir(tasksDir, { withFileTypes: true });
        const subDirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).sort((a, b) => b.name.localeCompare(a.name));
        for (const subDir of subDirs) {
          for (const fileName of taskFiles) {
            try {
              const content = await readFile(join(tasksDir, subDir.name, fileName), "utf-8");
              stateDocuments.push({
                path: `.agent-tasks/${subDir.name}/${fileName}`,
                content,
              });
            } catch {
              // File does not exist
            }
          }
          if (stateDocuments.length > 0) {
            break;
          }
        }
      }
    }
  } catch {
    // .agent-tasks directory is optional
  }

  let gitStatus: string | undefined;
  const exec: NonNullable<AutoDiscoverOptions["execFileFn"]> =
    options?.execFileFn ??
    (async (file, args, opts) => {
      const result = await execFileAsync(file, args, opts);
      return {
        stdout: typeof result.stdout === "string" ? result.stdout : result.stdout.toString("utf-8"),
        stderr: typeof result.stderr === "string" ? result.stderr : result.stderr.toString("utf-8"),
      };
    });

  try {
    const { stdout } = await exec("git", ["status", "--short"], {
      cwd: projectRoot,
      encoding: "utf-8",
      windowsHide: true,
    });
    if (stdout.trim().length > 0) {
      gitStatus = stdout.trim();
    }
  } catch {
    // Not a git repository or git not available, ignore gracefully
  }

  const result: AutoDiscoveredEvidence = {
    stateDocuments,
  };
  if (handoff !== undefined) {
    result.handoff = handoff;
  }
  if (gitStatus !== undefined) {
    result.gitStatus = gitStatus;
  }

  return result;
}
