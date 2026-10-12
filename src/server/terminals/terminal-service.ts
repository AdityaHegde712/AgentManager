import * as pty from "node-pty";

import { buildCodexCommand, buildGitBashCommand, type CodexLaunchOptions } from "./codex-command.js";


type OutputListener = (data: string) => void;
type ExitListener = (exitCode: number, signal?: number) => void;


type ManagedTerminal = {
  process: pty.IPty;
  outputListeners: Set<OutputListener>;
  exitListeners: Set<ExitListener>;
};


export class TerminalService {
  private readonly terminals = new Map<string, ManagedTerminal>();


  public constructor(
    private readonly codexCommand: string,
    private readonly onExit: (terminalId: string) => void,
    private readonly gitBashCommand?: string | null,
  ) {}


  public start(terminalId: string, cwd: string, options?: CodexLaunchOptions, gitBashCommand?: string | null): void {
    if (this.terminals.has(terminalId)) {
      throw new Error(`Terminal ${terminalId} is already running.`);
    }

    const bashCandidate = gitBashCommand !== undefined ? gitBashCommand : this.gitBashCommand;
    const gitBashPath = bashCandidate && bashCandidate.trim().length > 0 ? bashCandidate.trim() : null;
    const useBash = options?.shell !== "native" && Boolean(gitBashPath);

    const spec = useBash
      ? buildGitBashCommand(this.codexCommand, options, gitBashPath)
      : buildCodexCommand(this.codexCommand, options);

    const env: Record<string, string | undefined> = {
      ...process.env,
      TERM: "xterm-256color",
    };
    if (useBash && gitBashPath) {
      env.SHELL = gitBashPath;
    }

    const terminal = pty.spawn(spec.command, spec.args, {
      cwd,
      cols: 120,
      rows: 32,
      name: "xterm-256color",
      env: env as Record<string, string>,
    });
    const managed: ManagedTerminal = {
      process: terminal,
      outputListeners: new Set(),
      exitListeners: new Set(),
    };
    this.terminals.set(terminalId, managed);

    terminal.onData((data) => {
      for (const listener of managed.outputListeners) {
        listener(data);
      }
    });
    terminal.onExit(({ exitCode, signal }) => {
      this.terminals.delete(terminalId);
      this.onExit(terminalId);
      for (const listener of managed.exitListeners) {
        listener(exitCode, signal);
      }
    });
  }


  public write(terminalId: string, data: string): void {
    this.require(terminalId).process.write(data);
  }


  public resize(terminalId: string, cols: number, rows: number): void {
    if (cols < 1 || rows < 1) {
      throw new Error("Terminal dimensions must be positive.");
    }

    this.require(terminalId).process.resize(cols, rows);
  }


  public stop(terminalId: string): void {
    this.require(terminalId).process.kill();
  }


  public subscribe(terminalId: string, onOutput: OutputListener, onExit: ExitListener): () => void {
    const terminal = this.require(terminalId);
    terminal.outputListeners.add(onOutput);
    terminal.exitListeners.add(onExit);

    return () => {
      terminal.outputListeners.delete(onOutput);
      terminal.exitListeners.delete(onExit);
    };
  }


  private require(terminalId: string): ManagedTerminal {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      throw new Error(`Terminal ${terminalId} is not active.`);
    }

    return terminal;
  }
}
