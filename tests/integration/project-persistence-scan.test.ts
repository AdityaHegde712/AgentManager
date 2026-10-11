import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createApplication } from "../../src/server/app.js";
import { ProjectRegistry } from "../../src/server/projects/project-registry.js";
import { ProviderRegistry } from "../../src/server/providers/provider-registry.js";
import { SessionManager } from "../../src/server/sessions/session-manager.js";
import { TerminalService } from "../../src/server/terminals/terminal-service.js";

const applications: Array<Awaited<ReturnType<typeof createApplication>>> = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()));
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agent-runner-persist-"));
  tempDirs.push(dir);
  return dir;
}

describe("project persistence and reloading", () => {
  it("saves projects to projects.json and reloads them on fresh registry startup", async () => {
    const tempDir = await createTempDir();
    const storagePath = join(tempDir, "projects.json");

    const projectOneDir = join(tempDir, "alpha");
    const projectTwoDir = join(tempDir, "beta");
    await mkdir(projectOneDir);
    await mkdir(projectTwoDir);

    const registry = new ProjectRegistry(storagePath);
    await registry.add("alpha", projectOneDir);
    await registry.add("beta", projectTwoDir);

    // Verify storage file contents
    const content = await readFile(storagePath, "utf-8");
    const parsed = JSON.parse(content) as Array<{ alias: string; root: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed.map((p) => p.alias)).toEqual(["alpha", "beta"]);

    // Reload in fresh registry instance
    const freshRegistry = new ProjectRegistry(storagePath);
    expect(freshRegistry.list()).toHaveLength(2);
    expect(freshRegistry.require("alpha").root.toLowerCase()).toBe(projectOneDir.toLowerCase());
    expect(freshRegistry.require("beta").root.toLowerCase()).toBe(projectTwoDir.toLowerCase());
  });
});

describe("directory scan", () => {
  it("registers valid immediate subdirectories and skips hidden/system directories", async () => {
    const tempDir = await createTempDir();
    const storagePath = join(tempDir, "projects.json");
    const parentDir = join(tempDir, "workspace");
    await mkdir(parentDir);

    const repo1 = join(parentDir, "repo-one");
    const repo2 = join(parentDir, "repo-two");
    const hiddenDir = join(parentDir, ".hidden-repo");
    const nodeModules = join(parentDir, "node_modules");
    const appData = join(parentDir, "AppData");

    await mkdir(repo1);
    await mkdir(repo2);
    await mkdir(hiddenDir);
    await mkdir(nodeModules);
    await mkdir(appData);
    await writeFile(join(parentDir, "some-file.txt"), "not a directory", "utf-8");

    const registry = new ProjectRegistry(storagePath);
    const result = await registry.scanDirectory(parentDir);

    expect(result.added.map((item) => item.alias)).toEqual(["repo-one", "repo-two"]);
    expect(result.skipped).toEqual([".hidden-repo", "AppData", "node_modules"]);

    // Verify persistence
    const reloaded = new ProjectRegistry(storagePath);
    expect(reloaded.list().map((item) => item.alias)).toEqual(["repo-one", "repo-two"]);
  });

  it("handles directory scan via POST /api/v1/projects/scan endpoint", async () => {
    const tempDir = await createTempDir();
    const storagePath = join(tempDir, "projects.json");
    const parentDir = join(tempDir, "projects");
    await mkdir(parentDir);

    await mkdir(join(parentDir, "alpha-pkg"));
    await mkdir(join(parentDir, "beta-pkg"));
    await mkdir(join(parentDir, ".git"));

    const registry = new ProjectRegistry(storagePath);
    const application = await createApplication({
      launchToken: "test-token",
      providers: new ProviderRegistry([]),
      projects: registry,
      sessions: new SessionManager(2),
      terminals: new TerminalService("codex", () => undefined),
    });
    applications.push(application);

    const response = await application.inject({
      method: "POST",
      url: "/api/v1/projects/scan",
      headers: { "x-agent-runner-token": "test-token" },
      payload: { directory: parentDir },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { added: Array<{ alias: string }>; skipped: string[] };
    expect(body.added.map((p) => p.alias)).toEqual(["alpha-pkg", "beta-pkg"]);
    expect(body.skipped).toEqual([".git"]);

    // Verify registry updated
    expect(registry.list().map((p) => p.alias)).toEqual(["alpha-pkg", "beta-pkg"]);
  });

  it("returns 400 when scanning a non-existent parent directory", async () => {
    const registry = new ProjectRegistry(null);
    const application = await createApplication({
      launchToken: "test-token",
      providers: new ProviderRegistry([]),
      projects: registry,
      sessions: new SessionManager(2),
      terminals: new TerminalService("codex", () => undefined),
    });
    applications.push(application);

    const response = await application.inject({
      method: "POST",
      url: "/api/v1/projects/scan",
      headers: { "x-agent-runner-token": "test-token" },
      payload: { directory: join(tmpdir(), "non_existent_folder_xyz_123") },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Parent directory does not exist or is not a directory." });
  });
});

describe("project delete and rename endpoints with persistence", () => {
  it("deletes project via DELETE /api/v1/projects/:alias and persists removal", async () => {
    const tempDir = await createTempDir();
    const storagePath = join(tempDir, "projects.json");

    const p1Dir = join(tempDir, "proj-1");
    const p2Dir = join(tempDir, "proj-2");
    await mkdir(p1Dir);
    await mkdir(p2Dir);

    const registry = new ProjectRegistry(storagePath);
    await registry.add("proj-1", p1Dir);
    await registry.add("proj-2", p2Dir);

    const application = await createApplication({
      launchToken: "test-token",
      providers: new ProviderRegistry([]),
      projects: registry,
      sessions: new SessionManager(2),
      terminals: new TerminalService("codex", () => undefined),
    });
    applications.push(application);

    const deleteResponse = await application.inject({
      method: "DELETE",
      url: "/api/v1/projects/proj-1",
      headers: { "x-agent-runner-token": "test-token" },
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ success: true, alias: "proj-1" });

    // In-memory list updated
    expect(registry.list().map((p) => p.alias)).toEqual(["proj-2"]);

    // Reloaded registry reflects deletion
    const reloaded = new ProjectRegistry(storagePath);
    expect(reloaded.list().map((p) => p.alias)).toEqual(["proj-2"]);

    // Deleting again returns 404
    const notFoundResponse = await application.inject({
      method: "DELETE",
      url: "/api/v1/projects/proj-1",
      headers: { "x-agent-runner-token": "test-token" },
    });
    expect(notFoundResponse.statusCode).toBe(404);
  });

  it("renames project via PATCH /api/v1/projects/:alias and persists update", async () => {
    const tempDir = await createTempDir();
    const storagePath = join(tempDir, "projects.json");

    const pDir = join(tempDir, "original");
    await mkdir(pDir);

    const registry = new ProjectRegistry(storagePath);
    await registry.add("old-alias", pDir);

    const application = await createApplication({
      launchToken: "test-token",
      providers: new ProviderRegistry([]),
      projects: registry,
      sessions: new SessionManager(2),
      terminals: new TerminalService("codex", () => undefined),
    });
    applications.push(application);

    const patchResponse = await application.inject({
      method: "PATCH",
      url: "/api/v1/projects/old-alias",
      headers: { "x-agent-runner-token": "test-token" },
      payload: { alias: "new-alias" },
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json()).toEqual({
      project: {
        alias: "new-alias",
        root: pDir,
      },
    });

    expect(registry.list().map((p) => p.alias)).toEqual(["new-alias"]);

    // Reloaded registry reflects rename
    const reloaded = new ProjectRegistry(storagePath);
    expect(reloaded.list().map((p) => p.alias)).toEqual(["new-alias"]);
    expect(reloaded.require("new-alias").root.toLowerCase()).toBe(pDir.toLowerCase());

    // Renaming to existing alias returns 409 conflict
    const pConflict = join(tempDir, "conflict");
    await mkdir(pConflict);
    await registry.add("existing-alias", pConflict);
    const conflictResponse = await application.inject({
      method: "PATCH",
      url: "/api/v1/projects/new-alias",
      headers: { "x-agent-runner-token": "test-token" },
      payload: { alias: "existing-alias" },
    });
    expect(conflictResponse.statusCode).toBe(409);

    // Renaming unknown alias returns 404
    const notFoundResponse = await application.inject({
      method: "PATCH",
      url: "/api/v1/projects/non-existent",
      headers: { "x-agent-runner-token": "test-token" },
      payload: { alias: "whatever" },
    });
    expect(notFoundResponse.statusCode).toBe(404);
  });
});

describe("project path deduplication", () => {
  it("ignores duplicate project roots on registry.add and returns duplicate_ignored: true", async () => {
    const tempDir = await createTempDir();
    const storagePath = join(tempDir, "projects.json");
    const projDir = join(tempDir, "workspace");
    await mkdir(projDir);

    const registry = new ProjectRegistry(storagePath);
    const firstResult = await registry.add("primary-project", projDir);
    expect(firstResult.duplicate_ignored).toBe(false);
    expect(firstResult.project.alias).toBe("primary-project");

    // Attempt to add same directory under different alias
    const duplicateResult = await registry.add("duplicate-project", projDir);
    expect(duplicateResult.duplicate_ignored).toBe(true);
    expect(duplicateResult.project.alias).toBe("primary-project");

    // Attempt to add with different casing / trailing separator
    const caseResult = await registry.add("case-variant", `${projDir.toUpperCase()}/`);
    expect(caseResult.duplicate_ignored).toBe(true);
    expect(caseResult.project.alias).toBe("primary-project");

    // Registry list only has the original entry
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.alias).toBe("primary-project");
  });

  it("sanitizes duplicate project roots on startup load() from storage", async () => {
    const tempDir = await createTempDir();
    const storagePath = join(tempDir, "projects.json");
    const dirA = join(tempDir, "dir-a");
    const dirB = join(tempDir, "dir-b");
    await mkdir(dirA);
    await mkdir(dirB);

    // Manually write storage with duplicate roots
    const initialData = [
      { alias: "alpha", root: dirA },
      { alias: "duplicate-alpha", root: dirA },
      { alias: "beta", root: dirB },
    ];
    await writeFile(storagePath, JSON.stringify(initialData, null, 2), "utf-8");

    const registry = new ProjectRegistry(storagePath);
    expect(registry.list()).toHaveLength(2);
    expect(registry.list().map((p) => p.alias)).toEqual(["alpha", "beta"]);

    // Verify projects.json on disk was sanitized
    const savedContent = await readFile(storagePath, "utf-8");
    const savedList = JSON.parse(savedContent) as Array<{ alias: string; root: string }>;
    expect(savedList).toHaveLength(2);
    expect(savedList.map((p) => p.alias)).toEqual(["alpha", "beta"]);
  });

  it("handles duplicate root addition via POST /api/v1/projects endpoint", async () => {
    const tempDir = await createTempDir();
    const storagePath = join(tempDir, "projects.json");
    const dir = join(tempDir, "my-app");
    await mkdir(dir);

    const registry = new ProjectRegistry(storagePath);
    const application = await createApplication({
      launchToken: "test-token",
      providers: new ProviderRegistry([]),
      projects: registry,
      sessions: new SessionManager(2),
      terminals: new TerminalService("codex", () => undefined),
    });
    applications.push(application);

    // First POST: new project added
    const res1 = await application.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { "x-agent-runner-token": "test-token" },
      payload: { alias: "my-app", root: dir },
    });
    expect(res1.statusCode).toBe(201);
    const body1 = res1.json() as { project: { alias: string }; duplicate_ignored: boolean };
    expect(body1.duplicate_ignored).toBe(false);
    expect(body1.project.alias).toBe("my-app");

    // Second POST with same root: duplicate ignored
    const res2 = await application.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { "x-agent-runner-token": "test-token" },
      payload: { alias: "my-app-duplicate", root: dir },
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json() as { project: { alias: string }; duplicate_ignored: boolean };
    expect(body2.duplicate_ignored).toBe(true);
    expect(body2.project.alias).toBe("my-app");

    // Project list only contains single project
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.alias).toBe("my-app");
  });

  it("ignores already registered directories and reports duplicates in scanDirectory and POST /api/v1/projects/scan", async () => {
    const tempDir = await createTempDir();
    const storagePath = join(tempDir, "projects.json");
    const parentDir = join(tempDir, "monorepo");
    await mkdir(parentDir);

    const childA = join(parentDir, "pkg-a");
    const childB = join(parentDir, "pkg-b");
    const hiddenChild = join(parentDir, ".hidden");
    await mkdir(childA);
    await mkdir(childB);
    await mkdir(hiddenChild);

    const registry = new ProjectRegistry(storagePath);
    // Pre-register childA
    await registry.add("pkg-a-custom", childA);

    // Scan directory
    const scanResult = await registry.scanDirectory(parentDir);
    expect(scanResult.added.map((p) => p.alias)).toEqual(["pkg-b"]);
    expect(scanResult.duplicates).toEqual(["pkg-a"]);
    expect(scanResult.skipped).toEqual([".hidden"]);

    // Scan again via API endpoint
    const application = await createApplication({
      launchToken: "test-token",
      providers: new ProviderRegistry([]),
      projects: registry,
      sessions: new SessionManager(2),
      terminals: new TerminalService("codex", () => undefined),
    });
    applications.push(application);

    const scanApiResponse = await application.inject({
      method: "POST",
      url: "/api/v1/projects/scan",
      headers: { "x-agent-runner-token": "test-token" },
      payload: { directory: parentDir },
    });

    expect(scanApiResponse.statusCode).toBe(200);
    const apiBody = scanApiResponse.json() as {
      added: Array<{ alias: string }>;
      skipped: string[];
      duplicates: string[];
    };
    expect(apiBody.added).toEqual([]);
    expect(apiBody.duplicates).toEqual(["pkg-a", "pkg-b"]);
    expect(apiBody.skipped).toEqual([".hidden"]);
  });
});
