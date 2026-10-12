import * as pty from "node-pty";

import { buildCodexCommand, type CodexLaunchOptions } from "./codex-command.js";


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
  ) {}


  public start(terminalId: string, cwd: string, options?: CodexLaunchOptions): void {
    if (this.terminals.has(terminalId)) {
      throw new Error(`Terminal ${terminalId} is already running.`);
    }

    const spec = buildCodexCommand(this.codexCommand, options);
    const terminal = pty.spawn(spec.command, spec.args, {
      cwd,
      cols: 120,
      rows: 32,
      name: "xterm-256color",
      env: { ...process.env, TERM: "xterm-256color" },
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
