import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as pty from "node-pty";

import { createApplication } from "../../src/server/app.js";
import { ProjectRegistry } from "../../src/server/projects/project-registry.js";
import { ProviderRegistry } from "../../src/server/providers/provider-registry.js";
import { SessionManager } from "../../src/server/sessions/session-manager.js";
import { resolveCodexExecutable, resolveGitBashExecutable } from "../../src/server/system/binary-resolver.js";
import { buildCodexCommand, buildCodexResumePicker, buildGitBashCommand } from "../../src/server/terminals/codex-command.js";
import { TerminalService } from "../../src/server/terminals/terminal-service.js";


describe("codex-command builder", () => {
  it("rejects empty or whitespace command", () => {
    expect(() => buildCodexCommand("")).toThrow("Codex command must not be empty.");
    expect(() => buildCodexCommand("   ")).toThrow("Codex command must not be empty.");
  });

  it("defaults to resume mode with --all and --no-alt-screen when no options provided", () => {
    expect(buildCodexCommand("codex")).toEqual({
      command: "codex",
      args: ["resume", "--all", "--no-alt-screen"],
    });
  });

  it("maintains backward compatibility with buildCodexResumePicker", () => {
    expect(buildCodexResumePicker("codex")).toEqual({
      command: "codex",
      args: ["resume", "--all", "--no-alt-screen"],
    });
  });

  it("uses resume mode with specific sessionId", () => {
    expect(buildCodexCommand("codex", { mode: "resume", sessionId: "sess-987" })).toEqual({
      command: "codex",
      args: ["resume", "sess-987", "--no-alt-screen"],
    });
  });

  it("builds command for mode 'new'", () => {
    expect(buildCodexCommand("codex", { mode: "new" })).toEqual({
      command: "codex",
      args: ["--no-alt-screen"],
    });
  });

  it("appends model parameter when specified", () => {
    expect(buildCodexCommand("codex", { mode: "new", model: "gpt-5.6-terra" })).toEqual({
      command: "codex",
      args: ["--no-alt-screen", "-m", "gpt-5.6-terra"],
    });
  });

  it("appends reasoningEffort config flag when specified", () => {
    expect(buildCodexCommand("codex", { mode: "new", reasoningEffort: "high" })).toEqual({
      command: "codex",
      args: ["--no-alt-screen", "-c", 'model_reasoning_effort="high"'],
    });
  });

  it("combines resume mode, model, and reasoning effort", () => {
    expect(
      buildCodexCommand("codex", {
        mode: "resume",
        model: "gpt-5.6-terra",
        reasoningEffort: "medium",
      }),
    ).toEqual({
      command: "codex",
      args: [
        "resume",
        "--all",
        "--no-alt-screen",
        "-m",
        "gpt-5.6-terra",
        "-c",
        'model_reasoning_effort="medium"',
      ],
    });
  });

  it("buildGitBashCommand wraps codex invocation when shell is bash and bashPath is available", () => {
    expect(
      buildGitBashCommand("codex", { shell: "bash", mode: "resume" }, "C:\\Git\\bin\\bash.exe"),
    ).toEqual({
      command: "C:\\Git\\bin\\bash.exe",
      args: ["-l", "-i", "-c", '"codex" resume --all --no-alt-screen; exec bash'],
    });
  });

  it("buildGitBashCommand defaults to wrapping in bash when shell is omitted and bashPath is available", () => {
    expect(
      buildGitBashCommand("codex", undefined, "C:\\Git\\bin\\bash.exe"),
    ).toEqual({
      command: "C:\\Git\\bin\\bash.exe",
      args: ["-l", "-i", "-c", '"codex" resume --all --no-alt-screen; exec bash'],
    });
  });

  it("buildGitBashCommand properly escapes codexCommand containing spaces and normalizes backslashes", () => {
    expect(
      buildGitBashCommand(
        "C:\\Program Files\\Codex\\codex.exe",
        { shell: "bash", mode: "new", model: "gpt-5.6-terra" },
        "C:\\Git\\bin\\bash.exe",
      ),
    ).toEqual({
      command: "C:\\Git\\bin\\bash.exe",
      args: ["-l", "-i", "-c", '"C:/Program Files/Codex/codex.exe" --no-alt-screen -m gpt-5.6-terra; exec bash'],
    });
  });

  it("buildGitBashCommand normalizes Windows backslashes in executable paths without spaces", () => {
    expect(
      buildGitBashCommand(
        "C:\\Users\\hifia\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe",
        { shell: "bash", mode: "resume", sessionId: "sess-1" },
        "C:\\Git\\bin\\bash.exe",
      ),
    ).toEqual({
      command: "C:\\Git\\bin\\bash.exe",
      args: [
        "-l",
        "-i",
        "-c",
        '"C:/Users/hifia/AppData/Local/Programs/OpenAI/Codex/bin/codex.exe" resume sess-1 --no-alt-screen; exec bash',
      ],
    });
  });

  it("buildGitBashCommand falls back to native command when shell is 'native'", () => {
    expect(
      buildGitBashCommand("codex", { shell: "native", mode: "new" }, "C:\\Git\\bin\\bash.exe"),
    ).toEqual({
      command: "codex",
      args: ["--no-alt-screen"],
    });
  });

  it("buildGitBashCommand falls back to native command when bashPath is null or empty", () => {
    expect(
      buildGitBashCommand("codex", { shell: "bash", mode: "resume" }, null),
    ).toEqual({
      command: "codex",
      args: ["resume", "--all", "--no-alt-screen"],
    });

    expect(
      buildGitBashCommand("codex", { shell: "bash", mode: "resume" }, "   "),
    ).toEqual({
      command: "codex",
      args: ["resume", "--all", "--no-alt-screen"],
    });
  });
});


describe("binary-resolver", () => {
  const originalCodexCommand = process.env.CODEX_COMMAND;
  const originalGitBashCommand = process.env.GIT_BASH_COMMAND;

  afterEach(() => {
    if (originalCodexCommand !== undefined) {
      process.env.CODEX_COMMAND = originalCodexCommand;
    } else {
      delete process.env.CODEX_COMMAND;
    }

    if (originalGitBashCommand !== undefined) {
      process.env.GIT_BASH_COMMAND = originalGitBashCommand;
    } else {
      delete process.env.GIT_BASH_COMMAND;
    }
  });

  it("prefers process.env.CODEX_COMMAND when set", () => {
    process.env.CODEX_COMMAND = "C:\\custom\\path\\codex.exe";
    expect(resolveCodexExecutable()).toBe("C:\\custom\\path\\codex.exe");
  });

  it("resolves codex to an executable string without throwing", () => {
    delete process.env.CODEX_COMMAND;
    const resolved = resolveCodexExecutable();
    expect(typeof resolved).toBe("string");
    expect(resolved.length).toBeGreaterThan(0);
  });

  it("prefers process.env.GIT_BASH_COMMAND when set", () => {
    process.env.GIT_BASH_COMMAND = "C:\\custom\\path\\bash.exe";
    expect(resolveGitBashExecutable()).toBe("C:\\custom\\path\\bash.exe");
  });

  it("resolves git bash executable or returns null without throwing", () => {
    delete process.env.GIT_BASH_COMMAND;
    const resolved = resolveGitBashExecutable();
    expect(resolved === null || typeof resolved === "string").toBe(true);
  });
});


describe("TerminalService Git Bash spawning", () => {
  it("spawns Git Bash with POSIX env when gitBashCommand is provided", () => {
    const fakePty = {
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    };
    const spawnSpy = vi.spyOn(pty, "spawn").mockReturnValue(fakePty as unknown as pty.IPty);

    const service = new TerminalService("codex", vi.fn(), "C:\\Git\\bin\\bash.exe");
    service.start("term-1", "C:\\temp", { shell: "bash", mode: "resume" });

    expect(spawnSpy).toHaveBeenCalledWith(
      "C:\\Git\\bin\\bash.exe",
      ["-l", "-i", "-c", '"codex" resume --all --no-alt-screen; exec bash'],
      expect.objectContaining({
        cwd: "C:\\temp",
        env: expect.objectContaining({
          SHELL: "C:\\Git\\bin\\bash.exe",
          TERM: "xterm-256color",
        }),
      }),
    );
    spawnSpy.mockRestore();
  });

  it("spawns native command when shell is 'native'", () => {
    const fakePty = {
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    };
    const spawnSpy = vi.spyOn(pty, "spawn").mockReturnValue(fakePty as unknown as pty.IPty);

    const service = new TerminalService("codex", vi.fn(), "C:\\Git\\bin\\bash.exe");
    service.start("term-2", "C:\\temp", { shell: "native", mode: "new" });

    expect(spawnSpy).toHaveBeenCalledWith(
      "codex",
      ["--no-alt-screen"],
      expect.objectContaining({
        cwd: "C:\\temp",
        env: expect.not.objectContaining({
          SHELL: "C:\\Git\\bin\\bash.exe",
        }),
      }),
    );
    spawnSpy.mockRestore();
  });

  it("spawns native command when gitBashCommand is not provided", () => {
    const fakePty = {
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    };
    const spawnSpy = vi.spyOn(pty, "spawn").mockReturnValue(fakePty as unknown as pty.IPty);

    const service = new TerminalService("codex", vi.fn(), null);
    service.start("term-3", "C:\\temp", { shell: "bash" });

    expect(spawnSpy).toHaveBeenCalledWith(
      "codex",
      ["resume", "--all", "--no-alt-screen"],
      expect.objectContaining({
        cwd: "C:\\temp",
      }),
    );
    spawnSpy.mockRestore();
  });
});


describe("POST /api/v1/terminals integration", () => {
  let tempDir: string;
  const launchToken = "test-launch-token-123";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-runner-term-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("launches terminal with default resume mode, model, and reasoning effort", async () => {
    const projects = new ProjectRegistry();
    await projects.add("demo", tempDir);

    const startSpy = vi.fn();
    const fakeTerminals = {
      start: startSpy,
      subscribe: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      stop: vi.fn(),
    } as unknown as TerminalService;

    const app = await createApplication({
      launchToken,
      providers: new ProviderRegistry([]),
      projects,
      sessions: new SessionManager(2),
      terminals: fakeTerminals,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/terminals",
      headers: { "x-agent-runner-token": launchToken },
      payload: { project_alias: "demo" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.terminal_id).toBeDefined();
    expect(body.project.alias).toBe("demo");

    expect(startSpy).toHaveBeenCalledWith(
      body.terminal_id,
      projects.require("demo").root,
      {
        mode: "resume",
        model: "gpt-5.6-terra",
        reasoningEffort: "medium",
        shell: "bash",
      },
    );
  });

  it("launches terminal with parameterized options when provided", async () => {
    const projects = new ProjectRegistry();
    await projects.add("demo", tempDir);

    const startSpy = vi.fn();
    const fakeTerminals = {
      start: startSpy,
      subscribe: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      stop: vi.fn(),
    } as unknown as TerminalService;

    const app = await createApplication({
      launchToken,
      providers: new ProviderRegistry([]),
      projects,
      sessions: new SessionManager(2),
      terminals: fakeTerminals,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/terminals",
      headers: { "x-agent-runner-token": launchToken },
      payload: {
        project_alias: "demo",
        mode: "new",
        model: "gpt-5.6-terra",
        reasoning_effort: "high",
        shell: "native",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(startSpy).toHaveBeenCalledWith(
      body.terminal_id,
      projects.require("demo").root,
      {
        mode: "new",
        model: "gpt-5.6-terra",
        reasoningEffort: "high",
        shell: "native",
      },
    );
  });

  it("validates input and returns 422 for invalid mode or reasoning effort", async () => {
    const projects = new ProjectRegistry();
    await projects.add("demo", tempDir);

    const fakeTerminals = {
      start: vi.fn(),
      subscribe: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      stop: vi.fn(),
    } as unknown as TerminalService;

    const app = await createApplication({
      launchToken,
      providers: new ProviderRegistry([]),
      projects,
      sessions: new SessionManager(2),
      terminals: fakeTerminals,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/terminals",
      headers: { "x-agent-runner-token": launchToken },
      payload: {
        project_alias: "demo",
        mode: "invalid_mode",
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe("validation_error");
  });
});
