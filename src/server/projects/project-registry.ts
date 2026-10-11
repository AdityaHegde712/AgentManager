import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";


export type ProjectAlias = {
  alias: string;
  root: string;
};


export type AddProjectResult = {
  project: ProjectAlias;
  duplicate_ignored: boolean;
};


export type ScanDirectoryResult = {
  added: ProjectAlias[];
  skipped: string[];
  duplicates: string[];
};


const SYSTEM_DIR_NAMES = new Set([
  "node_modules",
  "appdata",
  "program files",
  "program files (x86)",
  "windows",
  "$recycle.bin",
  "system volume information",
]);


function shouldSkipDirectory(name: string): boolean {
  if (name.startsWith(".")) {
    return true;
  }
  return SYSTEM_DIR_NAMES.has(name.toLowerCase());
}


function canonicalizeRoot(rawPath: string): string {
  const expanded = rawPath.trim().replace(/^~(?=$|[/\\])/, homedir());
  return resolve(expanded).toLowerCase();
}


export class ProjectRegistry {
  private readonly storagePath?: string;
  private readonly projects = new Map<string, ProjectAlias>();


  public constructor(storagePath?: string | null) {
    if (storagePath === undefined) {
      this.storagePath = resolve(process.cwd(), ".agent-tasks/projects.json");
    } else if (storagePath === null || storagePath === "") {
      this.storagePath = undefined;
    } else {
      this.storagePath = resolve(storagePath);
    }

    this.load();
  }


  public load(): void {
    if (!this.storagePath || !existsSync(this.storagePath)) {
      return;
    }

    try {
      const raw = readFileSync(this.storagePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const seenRoots = new Set<string>();
        let hadDuplicates = false;
        for (const item of parsed) {
          if (item && typeof item.alias === "string" && typeof item.root === "string") {
            const normalizedAlias = item.alias.trim().toLowerCase();
            const canonical = canonicalizeRoot(item.root);
            if (normalizedAlias && !this.projects.has(normalizedAlias) && !seenRoots.has(canonical)) {
              seenRoots.add(canonical);
              const expanded = item.root.trim().replace(/^~(?=$|[/\\])/, homedir());
              this.projects.set(normalizedAlias, { alias: normalizedAlias, root: resolve(expanded) });
            } else if (normalizedAlias) {
              hadDuplicates = true;
            }
          }
        }
        if (hadDuplicates && this.storagePath) {
          try {
            writeFileSync(this.storagePath, JSON.stringify(this.list(), null, 2), "utf-8");
          } catch {
            // Ignore unreadable or unwritable storage file
          }
        }
      }
    } catch {
      // Ignore unreadable or corrupted storage file
    }
  }


  public async add(alias: string, root: string): Promise<AddProjectResult> {
    const normalizedAlias = alias.trim().toLowerCase();
    if (!normalizedAlias) {
      throw new Error("Project alias must not be empty.");
    }

    const expandedRoot = root.trim().replace(/^~(?=$|[/\\])/, homedir());
    const normalizedRoot = resolve(expandedRoot);
    let metadata;
    try {
      metadata = await stat(normalizedRoot);
    } catch {
      throw new Error("Project root does not exist or is not a directory.");
    }

    if (!metadata.isDirectory()) {
      throw new Error("Project root must be a directory.");
    }

    const canonicalRoot = normalizedRoot.toLowerCase();
    const existing = [...this.projects.values()].find(
      (item) => canonicalizeRoot(item.root) === canonicalRoot,
    );

    if (existing) {
      return { project: existing, duplicate_ignored: true };
    }

    const project = { alias: normalizedAlias, root: normalizedRoot };
    this.projects.set(normalizedAlias, project);
    await this.persist();
    return { project, duplicate_ignored: false };
  }


  public async delete(alias: string): Promise<boolean> {
    const normalizedAlias = alias.trim().toLowerCase();
    const existed = this.projects.delete(normalizedAlias);
    if (existed) {
      await this.persist();
    }
    return existed;
  }


  public async rename(oldAlias: string, newAlias: string): Promise<ProjectAlias> {
    const normalizedOld = oldAlias.trim().toLowerCase();
    const normalizedNew = newAlias.trim().toLowerCase();
    if (!normalizedNew) {
      throw new Error("Project alias must not be empty.");
    }

    const existing = this.projects.get(normalizedOld);
    if (!existing) {
      throw new Error(`Unknown project alias: ${oldAlias}`);
    }

    if (normalizedOld === normalizedNew) {
      return existing;
    }

    if (this.projects.has(normalizedNew)) {
      throw new Error(`Project alias already exists: ${newAlias}`);
    }

    this.projects.delete(normalizedOld);
    const updated = { alias: normalizedNew, root: existing.root };
    this.projects.set(normalizedNew, updated);
    await this.persist();
    return updated;
  }


  public async scanDirectory(parentDirectory: string): Promise<ScanDirectoryResult> {
    const expandedParent = parentDirectory.trim().replace(/^~(?=$|[/\\])/, homedir());
    const normalizedParent = resolve(expandedParent);

    let metadata;
    try {
      metadata = await stat(normalizedParent);
    } catch {
      throw new Error("Parent directory does not exist or is not a directory.");
    }

    if (!metadata.isDirectory()) {
      throw new Error("Parent directory must be a directory.");
    }

    const entries = await readdir(normalizedParent, { withFileTypes: true });
    const added: ProjectAlias[] = [];
    const skipped: string[] = [];
    const duplicates: string[] = [];

    const existingRoots = new Set<string>(
      [...this.projects.values()].map((p) => canonicalizeRoot(p.root)),
    );

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (shouldSkipDirectory(entry.name)) {
        skipped.push(entry.name);
        continue;
      }

      const root = resolve(normalizedParent, entry.name);
      const canonicalRoot = canonicalizeRoot(root);

      if (existingRoots.has(canonicalRoot)) {
        duplicates.push(entry.name);
        continue;
      }

      const sanitizedAlias = entry.name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const alias = sanitizedAlias || entry.name.toLowerCase().trim();
      const project = { alias, root };
      this.projects.set(alias, project);
      existingRoots.add(canonicalRoot);
      added.push(project);
    }

    added.sort((left, right) => left.alias.localeCompare(right.alias));
    skipped.sort((left, right) => left.localeCompare(right));
    duplicates.sort((left, right) => left.localeCompare(right));

    if (added.length > 0) {
      await this.persist();
    }

    return { added, skipped, duplicates };
  }


  public list(): ProjectAlias[] {
    return [...this.projects.values()].sort((left, right) => left.alias.localeCompare(right.alias));
  }


  public require(alias: string): ProjectAlias {
    const project = this.projects.get(alias.trim().toLowerCase());
    if (!project) {
      throw new Error(`Unknown project alias: ${alias}`);
    }

    return project;
  }


  private async persist(): Promise<void> {
    if (!this.storagePath) {
      return;
    }

    try {
      const dir = dirname(this.storagePath);
      await mkdir(dir, { recursive: true });
      const content = JSON.stringify(this.list(), null, 2);
      const tempPath = `${this.storagePath}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
      await writeFile(tempPath, content, "utf-8");
      try {
        await rename(tempPath, this.storagePath);
      } catch {
        await writeFile(this.storagePath, content, "utf-8");
        await rm(tempPath, { force: true }).catch(() => undefined);
      }
    } catch {
      // If persisting fails, do not crash in-memory operations
    }
  }
}
