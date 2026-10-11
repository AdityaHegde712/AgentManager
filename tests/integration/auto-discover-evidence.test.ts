import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { createApplication } from "../../src/server/app.js";
import { autoDiscoverProjectEvidence } from "../../src/server/evidence/auto-discover.js";
import { ProjectRegistry } from "../../src/server/projects/project-registry.js";
import { ProviderRegistry } from "../../src/server/providers/provider-registry.js";
import type { AssistantLlmProvider } from "../../src/server/providers/types.js";
import { SessionManager } from "../../src/server/sessions/session-manager.js";
import { TerminalService } from "../../src/server/terminals/terminal-service.js";

const execFileAsync = promisify(execFile);

const applications: Array<Awaited<ReturnType<typeof createApplication>>> = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()));
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

async function createTempProjectDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agent-runner-evidence-"));
  tempDirs.push(dir);
  return dir;
}

const mockProvider: AssistantLlmProvider = {
  id: "mock-provider",
  label: "Mock Provider",
  async healthCheck() {
    return { id: "mock-provider", label: "Mock Provider", status: "healthy" };
  },
  async listModels() {
    return [{ id: "mock-model", label: "Mock Model" }];
  },
  async createBrief(request) {
    return `Brief content for evidence:\n${request.evidence}`;
  },
};

describe("auto-discover project evidence", () => {
  it("discovers HANDOFF.md and .agent-tasks state documents properly", async () => {
    const projectRoot = await createTempProjectDir();

    await writeFile(join(projectRoot, "HANDOFF.md"), "# Handoff\nCurrent project state.", "utf-8");
    const tasksDir = join(projectRoot, ".agent-tasks");
    await mkdir(tasksDir, { recursive: true });
    await writeFile(join(tasksDir, "PLAN.md"), "# Plan\nRoadmap items.", "utf-8");
    await writeFile(join(tasksDir, "DECISIONS.md"), "# Decisions\nArchitecture decisions.", "utf-8");
    await writeFile(join(tasksDir, "TASKS.md"), "# Tasks\n1. Active task.", "utf-8");

    const result = await autoDiscoverProjectEvidence(projectRoot);

    expect(result.handoff).toBe("# Handoff\nCurrent project state.");
    expect(result.stateDocuments).toEqual([
      { path: ".agent-tasks/PLAN.md", content: "# Plan\nRoadmap items." },
      { path: ".agent-tasks/DECISIONS.md", content: "# Decisions\nArchitecture decisions." },
      { path: ".agent-tasks/TASKS.md", content: "# Tasks\n1. Active task." },
    ]);
  });

  it("captures git status when git repository exists with changes", async () => {
    const projectRoot = await createTempProjectDir();

    // Initialize git repository and create an untracked file
    await execFileAsync("git", ["init"], { cwd: projectRoot, windowsHide: true });
    await writeFile(join(projectRoot, "untracked.txt"), "hello git", "utf-8");

    const result = await autoDiscoverProjectEvidence(projectRoot);

    expect(result.gitStatus).toBeDefined();
    expect(result.gitStatus).toContain("untracked.txt");
  });

  it("handles non-git directory or git errors gracefully without throwing", async () => {
    const projectRoot = await createTempProjectDir();

    const result = await autoDiscoverProjectEvidence(projectRoot, {
      execFileFn: async () => {
        throw new Error("fatal: not a git repository");
      },
    });

    expect(result.gitStatus).toBeUndefined();
    expect(result.stateDocuments).toEqual([]);
    expect(result.handoff).toBeUndefined();
  });

  it("supports mock execFileFn runner for git status capture", async () => {
    const projectRoot = await createTempProjectDir();

    const result = await autoDiscoverProjectEvidence(projectRoot, {
      execFileFn: async () => ({
        stdout: " M src/index.ts\n?? notes.txt\n",
        stderr: "",
      }),
    });

    expect(result.gitStatus).toBe("M src/index.ts\n?? notes.txt");
  });
});

describe("POST /api/v1/briefs auto-discovery integration", () => {
  it("auto-discovers evidence and includes it in brief.evidence when project_alias is provided", async () => {
    const projectRoot = await createTempProjectDir();

    await writeFile(join(projectRoot, "HANDOFF.md"), "Project handoff notes.", "utf-8");
    const tasksDir = join(projectRoot, ".agent-tasks");
    await mkdir(tasksDir, { recursive: true });
    await writeFile(join(tasksDir, "PLAN.md"), "Plan step 1.", "utf-8");
    await writeFile(join(tasksDir, "DECISIONS.md"), "Decision A.", "utf-8");
    await writeFile(join(tasksDir, "TASKS.md"), "Task X is pending.", "utf-8");

    await execFileAsync("git", ["init"], { cwd: projectRoot, windowsHide: true });
    await writeFile(join(projectRoot, "work.txt"), "in progress", "utf-8");

    const projects = new ProjectRegistry();
    await projects.add("test-repo", projectRoot);

    const providerRegistry = new ProviderRegistry([mockProvider]);
    await providerRegistry.refreshHealth();

    const application = await createApplication({
      launchToken: "test-launch-token",
      providers: providerRegistry,
      projects,
      sessions: new SessionManager(2),
      terminals: new TerminalService("codex", () => undefined),
    });
    applications.push(application);

    const response = await application.inject({
      method: "POST",
      url: "/api/v1/briefs",
      headers: { "x-agent-runner-token": "test-launch-token" },
      payload: {
        project_alias: "test-repo",
        provider_id: "mock-provider",
        model: "mock-model",
        deliverable: "Implement the feature.",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.provider_id).toBe("mock-provider");
    expect(body.model).toBe("mock-model");

    const evidence = body.evidence as Array<{ kind: string; label: string; content: string }>;
    expect(evidence.map((item) => item.kind)).toEqual([
      "deliverable",
      "handoff",
      "state_document",
      "state_document",
      "state_document",
      "git_status",
    ]);

    const handoffItem = evidence.find((item) => item.kind === "handoff");
    expect(handoffItem?.content).toBe("Project handoff notes.");

    const planItem = evidence.find((item) => item.label === ".agent-tasks/PLAN.md");
    expect(planItem?.content).toBe("Plan step 1.");

    const decisionsItem = evidence.find((item) => item.label === ".agent-tasks/DECISIONS.md");
    expect(decisionsItem?.content).toBe("Decision A.");

    const tasksItem = evidence.find((item) => item.label === ".agent-tasks/TASKS.md");
    expect(tasksItem?.content).toBe("Task X is pending.");

    const gitItem = evidence.find((item) => item.kind === "git_status");
    expect(gitItem?.content).toContain("work.txt");
  });

  it("allows user-supplied overrides to take precedence over auto-discovered files", async () => {
    const projectRoot = await createTempProjectDir();

    await writeFile(join(projectRoot, "HANDOFF.md"), "Original handoff.", "utf-8");
    const tasksDir = join(projectRoot, ".agent-tasks");
    await mkdir(tasksDir, { recursive: true });
    await writeFile(join(tasksDir, "PLAN.md"), "Original plan.", "utf-8");
    await writeFile(join(tasksDir, "TASKS.md"), "Original tasks.", "utf-8");

    const projects = new ProjectRegistry();
    await projects.add("override-repo", projectRoot);

    const providerRegistry = new ProviderRegistry([mockProvider]);
    await providerRegistry.refreshHealth();

    const application = await createApplication({
      launchToken: "test-launch-token",
      providers: providerRegistry,
      projects,
      sessions: new SessionManager(2),
      terminals: new TerminalService("codex", () => undefined),
    });
    applications.push(application);

    const response = await application.inject({
      method: "POST",
      url: "/api/v1/briefs",
      headers: { "x-agent-runner-token": "test-launch-token" },
      payload: {
        project_alias: "override-repo",
        provider_id: "mock-provider",
        model: "mock-model",
        deliverable: "Deliverable with overrides.",
        handoff: "User override handoff.",
        state_documents: [
          { path: ".agent-tasks/PLAN.md", content: "User overridden plan." },
          { path: "CUSTOM.md", content: "Extra custom state." },
        ],
        git_status: "## custom/branch",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    const evidence = body.evidence as Array<{ kind: string; label: string; content: string }>;

    const handoffItem = evidence.find((item) => item.kind === "handoff");
    expect(handoffItem?.content).toBe("User override handoff.");

    const planItem = evidence.find((item) => item.label === ".agent-tasks/PLAN.md");
    expect(planItem?.content).toBe("User overridden plan.");

    // Un-overridden state document is preserved from auto-discovery
    const tasksItem = evidence.find((item) => item.label === ".agent-tasks/TASKS.md");
    expect(tasksItem?.content).toBe("Original tasks.");

    const customItem = evidence.find((item) => item.label === "CUSTOM.md");
    expect(customItem?.content).toBe("Extra custom state.");

    const gitItem = evidence.find((item) => item.kind === "git_status");
    expect(gitItem?.content).toBe("## custom/branch");
  });

  it("returns 409 error when project_alias is unknown", async () => {
    const application = await createApplication({
      launchToken: "test-launch-token",
      providers: new ProviderRegistry([mockProvider]),
      projects: new ProjectRegistry(),
      sessions: new SessionManager(2),
      terminals: new TerminalService("codex", () => undefined),
    });
    applications.push(application);

    const response = await application.inject({
      method: "POST",
      url: "/api/v1/briefs",
      headers: { "x-agent-runner-token": "test-launch-token" },
      payload: {
        project_alias: "nonexistent",
        provider_id: "mock-provider",
        model: "mock-model",
        deliverable: "Will fail.",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "Unknown project alias: nonexistent" });
  });
});
