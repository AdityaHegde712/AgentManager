import { homedir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createApplication } from "../../src/server/app.js";
import { ProjectRegistry } from "../../src/server/projects/project-registry.js";
import { ProviderRegistry } from "../../src/server/providers/provider-registry.js";
import { SessionManager } from "../../src/server/sessions/session-manager.js";
import { TerminalService } from "../../src/server/terminals/terminal-service.js";


describe("project registry tilde expansion and error handling", () => {
  it("expands ~ to user home directory when adding project", async () => {
    const registry = new ProjectRegistry();
    const { project } = await registry.add("home", "~");

    expect(project.alias).toBe("home");
    expect(project.root).toBe(resolve(homedir()));
  });

  it("expands ~/ relative path when directory exists", async () => {
    const registry = new ProjectRegistry();
    // process.cwd() is inside the home directory on this system
    const home = homedir();
    const cwd = process.cwd();

    if (cwd.startsWith(home)) {
      const relativePart = cwd.slice(home.length).replace(/^[/\\]/, "");
      const tildePath = `~/${relativePart.replace(/\\/g, "/")}`;
      const { project } = await registry.add("agent-runner", tildePath);

      expect(project.alias).toBe("agent-runner");
      expect(project.root.toLowerCase()).toBe(cwd.toLowerCase());
    } else {
      // Fallback: test with ~
      const { project } = await registry.add("home-fallback", "~");
      expect(project.root).toBe(resolve(home));
    }
  });

  it("throws descriptive error when directory does not exist", async () => {
    const registry = new ProjectRegistry();
    await expect(
      registry.add("non-existent", "~/non_existent_folder_xyz_12345"),
    ).rejects.toThrow("Project root does not exist or is not a directory.");
  });

  it("returns HTTP 400 with descriptive error when adding invalid directory via API", async () => {
    const registry = new ProjectRegistry();
    const app = await createApplication({
      launchToken: "test-token",
      providers: new ProviderRegistry([]),
      projects: registry,
      sessions: new SessionManager(2),
      terminals: new TerminalService("codex", () => undefined),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: {
        "x-agent-runner-token": "test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        alias: "fake-project",
        root: "~/non_existent_directory_99999",
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Project root does not exist or is not a directory.",
    });

    await app.close();
  });
});
