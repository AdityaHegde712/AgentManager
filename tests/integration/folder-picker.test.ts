import { afterEach, describe, expect, it } from "vitest";

import { createApplication } from "../../src/server/app.js";
import { ProjectRegistry } from "../../src/server/projects/project-registry.js";
import { ProviderRegistry } from "../../src/server/providers/provider-registry.js";
import { SessionManager } from "../../src/server/sessions/session-manager.js";
import { pickFolder } from "../../src/server/system/folder-picker.js";
import { TerminalService } from "../../src/server/terminals/terminal-service.js";


const applications: Array<Awaited<ReturnType<typeof createApplication>>> = [];


afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()));
});


describe("native Windows folder picker endpoint", () => {
  it("rejects unauthorized requests without valid launch token header", async () => {
    const application = await createApplication({
      launchToken: "valid-secret-token",
      providers: new ProviderRegistry([]),
      projects: new ProjectRegistry(),
      sessions: new SessionManager(2),
      terminals: new TerminalService("codex", () => undefined),
      pickFolder: async () => ({ canceled: false, path: "C:\\test\\dir" }),
    });
    applications.push(application);

    // Missing header
    const missingTokenResponse = await application.inject({
      method: "POST",
      url: "/api/v1/system/browse-folder",
    });
    expect(missingTokenResponse.statusCode).toBe(401);
    expect(missingTokenResponse.json()).toEqual({ error: "invalid_launch_token" });

    // Invalid header
    const invalidTokenResponse = await application.inject({
      method: "POST",
      url: "/api/v1/system/browse-folder",
      headers: { "x-agent-runner-token": "wrong-token" },
    });
    expect(invalidTokenResponse.statusCode).toBe(401);
    expect(invalidTokenResponse.json()).toEqual({ error: "invalid_launch_token" });
  });

  it("returns selected path payload when user picks a folder", async () => {
    const application = await createApplication({
      launchToken: "valid-secret-token",
      providers: new ProviderRegistry([]),
      projects: new ProjectRegistry(),
      sessions: new SessionManager(2),
      terminals: new TerminalService("codex", () => undefined),
      pickFolder: async () => ({ canceled: false, path: "C:\\Users\\hifia\\Projects\\Demo" }),
    });
    applications.push(application);

    const response = await application.inject({
      method: "POST",
      url: "/api/v1/system/browse-folder",
      headers: { "x-agent-runner-token": "valid-secret-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      canceled: false,
      path: "C:\\Users\\hifia\\Projects\\Demo",
    });
  });

  it("returns canceled payload when user cancels folder dialog", async () => {
    const application = await createApplication({
      launchToken: "valid-secret-token",
      providers: new ProviderRegistry([]),
      projects: new ProjectRegistry(),
      sessions: new SessionManager(2),
      terminals: new TerminalService("codex", () => undefined),
      pickFolder: async () => ({ canceled: true, path: null }),
    });
    applications.push(application);

    const response = await application.inject({
      method: "POST",
      url: "/api/v1/system/browse-folder",
      headers: { "x-agent-runner-token": "valid-secret-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      canceled: true,
      path: null,
    });
  });

  it("handles folder-picker execution safely on success, cancel, error, and non-windows", async () => {
    // Selected path from powershell
    const selectedResult = await pickFolder({
      platform: "win32",
      execFileFn: async () => ({ stdout: "C:\\Selected\\Project\r\n", stderr: "" }),
    });
    expect(selectedResult).toEqual({
      canceled: false,
      path: "C:\\Selected\\Project",
    });

    // Empty output (cancelled dialog)
    const canceledResult = await pickFolder({
      platform: "win32",
      execFileFn: async () => ({ stdout: "", stderr: "" }),
    });
    expect(canceledResult).toEqual({
      canceled: true,
      path: null,
    });

    // Error thrown (dialog or powershell failure)
    const errorResult = await pickFolder({
      platform: "win32",
      execFileFn: async () => {
        throw new Error("Process terminated");
      },
    });
    expect(errorResult).toEqual({
      canceled: true,
      path: null,
    });

    // Non-windows platform safety
    const nonWindowsResult = await pickFolder({
      platform: "linux",
    });
    expect(nonWindowsResult).toEqual({
      canceled: true,
      path: null,
    });
  });
});
