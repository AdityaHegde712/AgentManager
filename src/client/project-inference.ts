import type { ProjectAlias } from "./api.js";


export type ProjectInferenceResult =
  | { type: "none" }
  | { type: "single"; project: ProjectAlias }
  | { type: "multiple"; candidates: ProjectAlias[] };


export type UnregisteredCandidate = {
  candidateAlias: string;
  candidatePath?: string;
};


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


export function detectUnregisteredPathOrCandidate(text: string): UnregisteredCandidate | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  // 1. Look for explicit path patterns: ~/..., C:/..., /Users/..., etc.
  const pathRegex = /(?:^|\s)(~[/\\][^\s"',;]+|[a-zA-Z]:[/\\][^\s"',;]+|\/[a-zA-Z0-9_.-]+[/\\][^\s"',;]+)/;
  const pathMatch = trimmed.match(pathRegex);
  if (pathMatch && pathMatch[1]) {
    const rawPath = pathMatch[1].replace(/[.,;:)]+$/, "");
    const segments = rawPath.split(/[/\\]/).filter(Boolean);
    const lastSegment = segments[segments.length - 1] ?? "";
    if (lastSegment && lastSegment !== "~") {
      return {
        candidateAlias: lastSegment,
        candidatePath: rawPath,
      };
    }
  }

  // 2. Look for "project at <path>" or "project in <path>"
  const projectAtRegex = /(?:project\s+(?:at|in)\s+)([^\s"',;]+)/i;
  const projectAtMatch = trimmed.match(projectAtRegex);
  if (projectAtMatch && projectAtMatch[1]) {
    const rawPath = projectAtMatch[1].replace(/[.,;:)]+$/, "");
    const segments = rawPath.split(/[/\\]/).filter(Boolean);
    const lastSegment = segments[segments.length - 1] ?? rawPath;
    return {
      candidateAlias: lastSegment,
      candidatePath: rawPath,
    };
  }

  // 3. Look for "continue <name>" or "project <name>"
  const projectPhraseRegex = /(?:continue\s+([a-zA-Z0-9_-]+)|project\s+([a-zA-Z0-9_-]+))/i;
  const phraseMatch = trimmed.match(projectPhraseRegex);
  if (phraseMatch) {
    const candidateName = phraseMatch[1] ?? phraseMatch[2];
    if (
      candidateName &&
      candidateName.toLowerCase() !== "at" &&
      candidateName.toLowerCase() !== "in" &&
      candidateName.toLowerCase() !== "the"
    ) {
      return {
        candidateAlias: candidateName,
      };
    }
  }

  return null;
}
