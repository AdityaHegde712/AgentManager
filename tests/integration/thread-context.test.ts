import { describe, expect, it } from "vitest";

import { resolveThreadProject } from "../../src/client/thread-context.js";


describe("thread project context", () => {
  const projects = [
    { alias: "agent-runner", root: "C:/Projects/AgentRunner" },
    { alias: "research", root: "C:/Projects/Research" },
  ];

  it("uses the project explicitly attached to the orchestration thread", () => {
    expect(resolveThreadProject(projects, "research")).toEqual(projects[1]);
  });

  it("does not guess across several registered workspaces", () => {
    expect(resolveThreadProject(projects, null)).toBeUndefined();
  });

  it("uses the sole registered workspace when a thread has no explicit attachment", () => {
    expect(resolveThreadProject([projects[0]], null)).toEqual(projects[0]);
  });
});
