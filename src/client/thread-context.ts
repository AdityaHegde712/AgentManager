type ProjectWithAlias = {
  alias: string;
};


/**
 * Resolves the project scope encoded by an orchestration-thread URL.
 * An explicit URL scope is never silently replaced by an arbitrary project.
 */
export function resolveThreadProject<T extends ProjectWithAlias>(
  projects: readonly T[],
  requestedAlias: string | null | undefined,
): T | undefined {
  if (requestedAlias) {
    const explicitProject = projects.find((project) => project.alias === requestedAlias);
    if (explicitProject) {
      return explicitProject;
    }
  }

  return projects.length === 1 ? projects[0] : undefined;
}
