import { stat } from "node:fs/promises";
import { resolve } from "node:path";


export type ProjectAlias = {
  alias: string;
  root: string;
};


export class ProjectRegistry {
  private readonly projects = new Map<string, ProjectAlias>();


  public async add(alias: string, root: string): Promise<ProjectAlias> {
    const normalizedAlias = alias.trim().toLowerCase();
    if (!normalizedAlias) {
      throw new Error("Project alias must not be empty.");
    }

    const normalizedRoot = resolve(root);
    const metadata = await stat(normalizedRoot);
    if (!metadata.isDirectory()) {
      throw new Error("Project root must be a directory.");
    }

    const project = { alias: normalizedAlias, root: normalizedRoot };
    this.projects.set(normalizedAlias, project);
    return project;
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
}
