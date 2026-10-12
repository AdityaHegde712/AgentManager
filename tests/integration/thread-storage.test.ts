import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createApplication } from "../../src/server/app.js";
import { ProjectRegistry } from "../../src/server/projects/project-registry.js";
import { ProviderRegistry } from "../../src/server/providers/provider-registry.js";
import { SessionManager } from "../../src/server/sessions/session-manager.js";
import { TerminalService } from "../../src/server/terminals/terminal-service.js";
import { ThreadStorage } from "../../src/server/threads/thread-storage.js";

const applications: Array<Awaited<ReturnType<typeof createApplication>>> = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()));
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agent-runner-threads-"));
  tempDirs.push(dir);
  return dir;
}

describe("ThreadStorage service", () => {
  it("initializes storage directory and lists empty threads", async () => {
    const tempDir = await createTempDir();
    const storage = new ThreadStorage(join(tempDir, "conversations"));

    const threads = await storage.listThreads();
    expect(threads).toEqual([]);
  });

  it("creates, retrieves, and persists threads with messages", async () => {
    const tempDir = await createTempDir();
    const conversationsDir = join(tempDir, "conversations");
    const storage = new ThreadStorage(conversationsDir);

    const created = await storage.createThread({
      title: "Feature branch planning",
      projectAlias: "alpha",
    });

    expect(created.id).toBeDefined();
    expect(created.title).toBe("Feature branch planning");
    expect(created.projectAlias).toBe("alpha");
    expect(created.messages).toEqual([]);

    // Verify file written to disk with UTF-8
    const diskContent = await readFile(join(conversationsDir, `${created.id}.json`), "utf-8");
    const parsedFromDisk = JSON.parse(diskContent);
    expect(parsedFromDisk.id).toBe(created.id);
    expect(parsedFromDisk.title).toBe("Feature branch planning");

    // Retrieve via getThread
    const fetched = await storage.getThread(created.id);
    expect(fetched).toEqual(created);

    // Save messages
    const sampleMessages = [
      { id: "msg-1", role: "user", text: "Hello agent" },
      { id: "msg-2", role: "assistant", text: "Ready to assist" },
    ];
    const updated = await storage.saveMessages(created.id, sampleMessages);
    expect(updated.messages).toEqual(sampleMessages);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.updatedAt).getTime());

    // Verify listThreads summaries
    const list = await storage.listThreads();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      id: created.id,
      title: "Feature branch planning",
      projectAlias: "alpha",
      createdAt: created.createdAt,
      updatedAt: updated.updatedAt,
      messageCount: 2,
    });
  });

  it("updates thread metadata and deletes threads", async () => {
    const tempDir = await createTempDir();
    const storage = new ThreadStorage(join(tempDir, "conversations"));

    const thread = await storage.createThread({ title: "Initial Title" });
    const updated = await storage.updateThread(thread.id, {
      title: "Updated Title",
      projectAlias: "core-repo",
    });

    expect(updated.title).toBe("Updated Title");
    expect(updated.projectAlias).toBe("core-repo");

    const deleted = await storage.deleteThread(thread.id);
    expect(deleted).toBe(true);

    const missing = await storage.getThread(thread.id);
    expect(missing).toBeNull();

    const deleteAgain = await storage.deleteThread(thread.id);
    expect(deleteAgain).toBe(false);
  });
});

describe("Thread REST endpoints", () => {
  async function setupApp() {
    const tempDir = await createTempDir();
    const storage = new ThreadStorage(join(tempDir, "conversations"));
    const token = "test-launch-token";

    const app = await createApplication({
      launchToken: token,
      providers: new ProviderRegistry([]),
      projects: new ProjectRegistry(null),
      sessions: new SessionManager(1),
      terminals: new TerminalService("dummy", () => {}),
      threads: storage,
    });
    applications.push(app);

    return { app, token, storage };
  }

  it("requires launch token header for thread endpoints", async () => {
    const { app } = await setupApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/threads",
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ error: "invalid_launch_token" });
  });

  it("supports the full thread lifecycle over HTTP", async () => {
    const { app, token } = await setupApp();
    const headers = { "x-agent-runner-token": token };

    // 1. Initial list should be empty
    const listRes1 = await app.inject({
      method: "GET",
      url: "/api/v1/threads",
      headers,
    });
    expect(listRes1.statusCode).toBe(200);
    expect(JSON.parse(listRes1.body)).toEqual({ threads: [] });

    // 2. Create thread
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/threads",
      headers,
      payload: { title: "Sprint Planning", projectAlias: "backend" },
    });
    expect(createRes.statusCode).toBe(201);
    const createdThread = JSON.parse(createRes.body).thread;
    expect(createdThread.id).toBeDefined();
    expect(createdThread.title).toBe("Sprint Planning");
    expect(createdThread.projectAlias).toBe("backend");
    expect(createdThread.messages).toEqual([]);

    // 3. Get thread by id
    const getRes = await app.inject({
      method: "GET",
      url: `/api/v1/threads/${createdThread.id}`,
      headers,
    });
    expect(getRes.statusCode).toBe(200);
    expect(JSON.parse(getRes.body).thread.id).toBe(createdThread.id);

    // 4. Save messages
    const messages = [
      { id: "1", role: "user", text: "Implement persistent storage" },
      { id: "2", role: "assistant", text: "Storage implemented" },
    ];
    const saveRes = await app.inject({
      method: "PUT",
      url: `/api/v1/threads/${createdThread.id}/messages`,
      headers,
      payload: { messages },
    });
    expect(saveRes.statusCode).toBe(200);
    const updatedWithMessages = JSON.parse(saveRes.body).thread;
    expect(updatedWithMessages.messages).toEqual(messages);

    // 5. Update thread title and project
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/threads/${createdThread.id}`,
      headers,
      payload: { title: "Renamed Sprint Thread", projectAlias: "frontend" },
    });
    expect(patchRes.statusCode).toBe(200);
    const patchedThread = JSON.parse(patchRes.body).thread;
    expect(patchedThread.title).toBe("Renamed Sprint Thread");
    expect(patchedThread.projectAlias).toBe("frontend");

    // 6. Verify list threads contains summary with messageCount
    const listRes2 = await app.inject({
      method: "GET",
      url: "/api/v1/threads",
      headers,
    });
    expect(listRes2.statusCode).toBe(200);
    const threads = JSON.parse(listRes2.body).threads;
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe(createdThread.id);
    expect(threads[0].title).toBe("Renamed Sprint Thread");
    expect(threads[0].projectAlias).toBe("frontend");
    expect(threads[0].messageCount).toBe(2);

    // 7. Delete thread
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/threads/${createdThread.id}`,
      headers,
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(JSON.parse(deleteRes.body)).toEqual({ success: true, threadId: createdThread.id });

    // 8. Get deleted thread returns 404
    const getDeletedRes = await app.inject({
      method: "GET",
      url: `/api/v1/threads/${createdThread.id}`,
      headers,
    });
    expect(getDeletedRes.statusCode).toBe(404);
  });
});
