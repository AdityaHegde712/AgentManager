export type CommandSpec = {
  command: string;
  args: string[];
};


export type CodexLaunchOptions = {
  mode?: "resume" | "new";
  model?: string;
  reasoningEffort?: "low" | "medium" | "high";
  sessionId?: string;
  shell?: "bash" | "native";
};


export function buildCodexCommand(command: string, options?: CodexLaunchOptions): CommandSpec {
  if (!command.trim()) {
    throw new Error("Codex command must not be empty.");
  }

  const mode = options?.mode ?? "resume";
  const args: string[] = [];

  if (mode === "resume") {
    args.push("resume");
    if (options?.sessionId) {
      args.push(options.sessionId);
    } else {
      args.push("--all");
    }
    args.push("--no-alt-screen");
  } else {
    args.push("--no-alt-screen");
  }

  if (options?.model) {
    args.push("-m", options.model);
  }

  if (options?.reasoningEffort) {
    args.push("-c", `model_reasoning_effort="${options.reasoningEffort}"`);
  }

  return {
    command,
    args,
  };
}


export function buildCodexResumePicker(codexCommand: string): CommandSpec {
  return buildCodexCommand(codexCommand, { mode: "resume" });
}


export function buildGitBashCommand(
  codexCommand: string,
  options?: CodexLaunchOptions,
  bashPath?: string | null,
): CommandSpec {
  const baseSpec = buildCodexCommand(codexCommand, options);
  if (options?.shell !== "native" && bashPath && bashPath.trim().length > 0) {
    const normalizedCommand = baseSpec.command.replace(/\\/g, "/").replace(/^["']|["']$/g, "");
    const commandPart = `"${normalizedCommand}"`;
    const formattedArgs = baseSpec.args.map((arg) => {
      const normalizedArg = arg.replace(/\\/g, "/");
      if (normalizedArg.includes(" ") && !normalizedArg.startsWith('"') && !normalizedArg.startsWith("'")) {
        return `"${normalizedArg}"`;
      }
      return normalizedArg;
    });
    const codexInvocation = [commandPart, ...formattedArgs].join(" ");
    return {
      command: bashPath.trim(),
      args: ["-l", "-i", "-c", `${codexInvocation}; exec bash`],
    };
  }

  return baseSpec;
}
