export type CommandSpec = {
  command: string;
  args: string[];
};


export function buildCodexResumePicker(codexCommand: string): CommandSpec {
  if (!codexCommand.trim()) {
    throw new Error("Codex command must not be empty.");
  }

  return {
    command: codexCommand,
    args: ["resume", "--all", "--no-alt-screen"],
  };
}
