import type { ProjectAlias } from "./api.js";


export type ProjectInferenceResult =
  | { type: "none" }
  | { type: "single"; project: ProjectAlias }
  | { type: "multiple"; candidates: ProjectAlias[] };


function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


function isAliasMatch(text: string, alias: string): boolean {
  const trimmed = alias.trim();
  if (!trimmed) {
    return false;
  }

  const escaped = escapeRegExp(trimmed);
  const regex = new RegExp(`(^|[^a-zA-Z0-9_])${escaped}([^a-zA-Z0-9_]|$)`, "i");
  return regex.test(text);
}


export function inferProject(text: string, projects: ProjectAlias[]): ProjectInferenceResult {
  if (!text.trim() || !projects.length) {
    return { type: "none" };
  }

  const matches = projects.filter((project) => isAliasMatch(text, project.alias));

  // Deduplicate by normalized alias
  const uniqueMatches = matches.filter(
    (project, index, self) =>
      index === self.findIndex((p) => p.alias.toLowerCase() === project.alias.toLowerCase()),
  );

  if (uniqueMatches.length === 0) {
    return { type: "none" };
  }

  if (uniqueMatches.length === 1) {
    return { type: "single", project: uniqueMatches[0] };
  }

  return { type: "multiple", candidates: uniqueMatches };
}
