import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import crypto from "node:crypto";

export type ThreadSummary = {
  id: string;
  title: string;
  projectAlias?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export type ThreadRecord = {
  id: string;
  title: string;
  projectAlias?: string;
  createdAt: string;
  updatedAt: string;
  messages: unknown[];
};

export type CreateThreadInput = {
  id?: string;
  title?: string;
  projectAlias?: string;
  messages?: unknown[];
};

export type UpdateThreadInput = {
  title?: string;
  projectAlias?: string | null;
};

export class ThreadStorage {
  private readonly storageDir: string;

  public constructor(storageDir?: string) {
    this.storageDir = storageDir ? resolve(storageDir) : resolve(process.cwd(), ".agent-tasks/conversations");
  }

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.storageDir)) {
      await mkdir(this.storageDir, { recursive: true });
    }
  }

  private getThreadFilePath(id: string): string {
    const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!sanitized) {
      throw new Error("Invalid thread ID");
    }
    return join(this.storageDir, `${sanitized}.json`);
  }

  public async listThreads(): Promise<ThreadSummary[]> {
    await this.ensureDir();
    let entries: string[] = [];
    try {
      entries = await readdir(this.storageDir);
    } catch {
      return [];
    }

    const summaries: ThreadSummary[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) {
        continue;
      }
      try {
        const filePath = join(this.storageDir, entry);
        const content = await readFile(filePath, "utf-8");
        const parsed = JSON.parse(content) as ThreadRecord;
        if (parsed && typeof parsed.id === "string") {
          summaries.push({
            id: parsed.id,
            title: parsed.title ?? "New orchestration thread",
            projectAlias: parsed.projectAlias,
            createdAt: parsed.createdAt ?? new Date().toISOString(),
            updatedAt: parsed.updatedAt ?? new Date().toISOString(),
            messageCount: Array.isArray(parsed.messages) ? parsed.messages.length : 0,
          });
        }
      } catch {
        // Skip unreadable or corrupted files
      }
    }

    summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return summaries;
  }

  public async getThread(id: string): Promise<ThreadRecord | null> {
    await this.ensureDir();
    const filePath = this.getThreadFilePath(id);
    if (!existsSync(filePath)) {
      return null;
    }
    try {
      const content = await readFile(filePath, "utf-8");
      return JSON.parse(content) as ThreadRecord;
    } catch {
      return null;
    }
  }

  public async createThread(input?: CreateThreadInput): Promise<ThreadRecord> {
    await this.ensureDir();
    const now = new Date().toISOString();
    const threadId = input?.id && input.id.trim() ? input.id.trim() : crypto.randomUUID();
    const thread: ThreadRecord = {
      id: threadId,
      title: input?.title?.trim() || "New orchestration thread",
      projectAlias: input?.projectAlias?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
      messages: input?.messages ?? [],
    };

    const filePath = this.getThreadFilePath(thread.id);
    await writeFile(filePath, JSON.stringify(thread, null, 2), "utf-8");
    return thread;
  }

  public async saveMessages(threadId: string, messages: unknown[]): Promise<ThreadRecord> {
    await this.ensureDir();
    const thread = await this.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    thread.messages = messages;
    thread.updatedAt = new Date().toISOString();

    const filePath = this.getThreadFilePath(threadId);
    await writeFile(filePath, JSON.stringify(thread, null, 2), "utf-8");
    return thread;
  }

  public async updateThread(id: string, updates: UpdateThreadInput): Promise<ThreadRecord> {
    await this.ensureDir();
    const thread = await this.getThread(id);
    if (!thread) {
      throw new Error(`Thread not found: ${id}`);
    }

    if (updates.title !== undefined) {
      thread.title = updates.title.trim();
    }
    if (updates.projectAlias !== undefined) {
      thread.projectAlias = updates.projectAlias ? updates.projectAlias.trim() : undefined;
    }
    thread.updatedAt = new Date().toISOString();

    const filePath = this.getThreadFilePath(id);
    await writeFile(filePath, JSON.stringify(thread, null, 2), "utf-8");
    return thread;
  }

  public async deleteThread(id: string): Promise<boolean> {
    await this.ensureDir();
    const filePath = this.getThreadFilePath(id);
    if (!existsSync(filePath)) {
      return false;
    }
    await rm(filePath, { force: true });
    return true;
  }
}
