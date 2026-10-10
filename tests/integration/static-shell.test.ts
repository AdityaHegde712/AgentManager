import { afterEach, describe, expect, it } from "vitest";

import { createApplication } from "../../src/server/app.js";
import { ProjectRegistry } from "../../src/server/projects/project-registry.js";
import { ProviderRegistry } from "../../src/server/providers/provider-registry.js";
import { SessionManager } from "../../src/server/sessions/session-manager.js";
import { TerminalService } from "../../src/server/terminals/terminal-service.js";


const applications: Array<Awaited<ReturnType<typeof createApplication>>> = [];


afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()));
});


describe("single-server shell", () => {
  it("serves the built UI publicly while keeping API routes token-protected", async () => {
    const application = await createApplication({
      launchToken: "launch-token",
      providers: new ProviderRegistry([]),
      projects: new ProjectRegistry(),
      sessions: new SessionManager(2),
      terminals: new TerminalService("codex", () => undefined),
    });
    applications.push(application);

    const shell = await application.inject({ method: "GET", url: "/" });
    const protectedApi = await application.inject({ method: "GET", url: "/api/v1/health" });

    expect(shell.statusCode).toBe(200);
    expect(shell.headers["content-type"]).toContain("text/html");
    expect(protectedApi.statusCode).toBe(401);
  });

  it("handles POST /api/v1/providers/refresh with and without body when content-type is sent", async () => {
    const application = await createApplication({
      launchToken: "launch-token",
      providers: new ProviderRegistry([]),
      projects: new ProjectRegistry(),
      sessions: new SessionManager(2),
      terminals: new TerminalService("codex", () => undefined),
    });
    applications.push(application);

    // POST with no body and no content-type
    const resNoBody = await application.inject({
      method: "POST",
      url: "/api/v1/providers/refresh",
      headers: { "x-agent-runner-token": "launch-token" },
    });
    expect(resNoBody.statusCode).toBe(200);
    expect(resNoBody.json()).toEqual({ providers: [] });

    // POST with empty body but content-type: application/json set
    const resEmptyJsonBody = await application.inject({
      method: "POST",
      url: "/api/v1/providers/refresh",
      headers: {
        "x-agent-runner-token": "launch-token",
        "content-type": "application/json",
      },
      body: "",
    });
    expect(resEmptyJsonBody.statusCode).toBe(200);
    expect(resEmptyJsonBody.json()).toEqual({ providers: [] });

    // POST with whitespace body and content-type: application/json set
    const resWhitespaceBody = await application.inject({
      method: "POST",
      url: "/api/v1/providers/refresh",
      headers: {
        "x-agent-runner-token": "launch-token",
        "content-type": "application/json",
      },
      body: "   ",
    });
    expect(resWhitespaceBody.statusCode).toBe(200);
    expect(resWhitespaceBody.json()).toEqual({ providers: [] });
  });
});
