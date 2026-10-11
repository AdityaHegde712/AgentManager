import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/main.js";
import { createApplication } from "../../src/server/app.js";
import { ProjectRegistry } from "../../src/server/projects/project-registry.js";
import { createOpenRouterProvider } from "../../src/server/providers/openrouter-provider.js";
import { ProviderRegistry } from "../../src/server/providers/provider-registry.js";
import { SessionManager } from "../../src/server/sessions/session-manager.js";
import { TerminalService } from "../../src/server/terminals/terminal-service.js";


describe("CLI debug utility", () => {
  let app: Awaited<ReturnType<typeof createApplication>>;
  let serverUrl: string;
  const launchToken = "test-cli-launch-token";

  beforeEach(async () => {
    const fetchMock = async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          data: [
            { id: "openrouter/free", pricing: { prompt: "0", completion: "0" } },
            { id: "test-model:free", pricing: { prompt: "0", completion: "0" } },
          ],
          choices: [{ message: { content: "Mock continuation brief for testing." } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchMock,
      autoRouter: true,
    });

    const providers = new ProviderRegistry([provider]);
    await providers.refreshHealth();

    const projects = new ProjectRegistry(null);
    const sessions = new SessionManager(2);
    const terminals = new TerminalService("codex", () => undefined);

    app = await createApplication({
      launchToken,
      providers,
      projects,
      sessions,
      terminals,
    });

    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    serverUrl = address;
  });

  afterEach(async () => {
    await app.close();
  });

  it("prints help and usage with exit code 0", async () => {
    const stdout: string[] = [];
    const exitCode = await runCli(["help"], {
      stdout: (msg) => stdout.push(msg),
    });

    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("AgentRunner CLI Debug Utility");
    expect(stdout.join("\n")).toContain("status / health");
  });

  it("queries status and reports healthy server and providers", async () => {
    const stdout: string[] = [];
    const exitCode = await runCli(["status", "--url", serverUrl, "--token", launchToken], {
      stdout: (msg) => stdout.push(msg),
    });

    expect(exitCode).toBe(0);
    const output = stdout.join("\n");
    expect(output).toContain("Server Status: healthy");
    expect(output).toContain("OpenRouter");
  });

  it("registers a project and lists registered projects", async () => {
    const stdout: string[] = [];
    const registerCode = await runCli(
      ["register", "my-app", process.cwd(), "--url", serverUrl, "--token", launchToken],
      { stdout: (msg) => stdout.push(msg) },
    );

    expect(registerCode).toBe(0);
    expect(stdout.join("\n")).toContain("Successfully registered project 'my-app'");

    const listStdout: string[] = [];
    const listCode = await runCli(["projects", "--url", serverUrl, "--token", launchToken], {
      stdout: (msg) => listStdout.push(msg),
    });

    expect(listCode).toBe(0);
    expect(listStdout.join("\n")).toContain("my-app");
  });

  it("drafts continuation brief for deliverable", async () => {
    const stdout: string[] = [];
    const exitCode = await runCli(
      [
        "brief",
        "--deliverable",
        "Implement login screen",
        "--url",
        serverUrl,
        "--token",
        launchToken,
      ],
      { stdout: (msg) => stdout.push(msg) },
    );

    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("Mock continuation brief for testing.");
  });

  it("queries terminals", async () => {
    const stdout: string[] = [];
    const exitCode = await runCli(["terminals", "--url", serverUrl, "--token", launchToken], {
      stdout: (msg) => stdout.push(msg),
    });

    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("Active Terminals");
  });

  it("rejects unauthorized command with non-zero exit code", async () => {
    const stderr: string[] = [];
    const exitCode = await runCli(["status", "--url", serverUrl, "--token", "invalid-token"], {
      stderr: (msg) => stderr.push(msg),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("HTTP 401");
  });
});
