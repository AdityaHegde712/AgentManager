import { describe, expect, it } from "vitest";

import { detectUnregisteredPathOrCandidate, inferProject } from "../../src/client/project-inference.js";


describe("project inference helper", () => {
  const projects = [
    { alias: "AgentRunner", root: "C:/Projects/AgentRunner" },
    { alias: "ResumeGenerator", root: "C:/Projects/ResumeGenerator" },
    { alias: "NLP", root: "C:/Projects/NLP" },
    { alias: "research-hub", root: "C:/Projects/ResearchHub" },
  ];

  it("returns none when text is empty or no projects provided", () => {
    expect(inferProject("", projects)).toEqual({ type: "none" });
    expect(inferProject("   ", projects)).toEqual({ type: "none" });
    expect(inferProject("hello world", [])).toEqual({ type: "none" });
  });

  it("returns none when no matching project alias exists in text", () => {
    expect(inferProject("continue the website deliverable please", projects)).toEqual({
      type: "none",
    });
  });

  it("does not match an alias embedded inside another word", () => {
    expect(inferProject("continue AgentRunnerXYZ right now", projects)).toEqual({
      type: "none",
    });
    expect(inferProject("check myNLPproject please", projects)).toEqual({
      type: "none",
    });
  });

  it("returns single match case-insensitively and with word boundaries", () => {
    // Exact match
    expect(inferProject("AgentRunner", projects)).toEqual({
      type: "single",
      project: { alias: "AgentRunner", root: "C:/Projects/AgentRunner" },
    });

    // Lowercase in middle of sentence
    expect(inferProject("please continue agentrunner next deliverable", projects)).toEqual({
      type: "single",
      project: { alias: "AgentRunner", root: "C:/Projects/AgentRunner" },
    });

    // Punctuated
    expect(inferProject("work on [ResumeGenerator]: add export feature", projects)).toEqual({
      type: "single",
      project: { alias: "ResumeGenerator", root: "C:/Projects/ResumeGenerator" },
    });

    // Hyphenated alias
    expect(inferProject("let's work on research-hub today", projects)).toEqual({
      type: "single",
      project: { alias: "research-hub", root: "C:/Projects/ResearchHub" },
    });
  });

  it("returns multiple matches when several projects are referenced", () => {
    const result = inferProject("compare AgentRunner against ResumeGenerator", projects);

    expect(result.type).toBe("multiple");
    if (result.type === "multiple") {
      expect(result.candidates).toHaveLength(2);
      expect(result.candidates.map((c) => c.alias)).toContain("AgentRunner");
      expect(result.candidates.map((c) => c.alias)).toContain("ResumeGenerator");
    }
  });

  it("deduplicates identical matching project aliases", () => {
    const duplicateProjects = [
      { alias: "AgentRunner", root: "C:/Projects/AgentRunner1" },
      { alias: "agentrunner", root: "C:/Projects/AgentRunner2" },
    ];

    expect(inferProject("work on AgentRunner", duplicateProjects)).toEqual({
      type: "single",
      project: { alias: "AgentRunner", root: "C:/Projects/AgentRunner1" },
    });
  });

  it("infers sandbox project alias from prompt with trailing verb stop words", () => {
    expect(
      inferProject(
        "My sandbox project needs a new AGENTS.md so can we set up the brief for that?",
        [{ alias: "sandbox", root: "C:/Projects/sandbox" }],
      ),
    ).toEqual({
      type: "single",
      project: { alias: "sandbox", root: "C:/Projects/sandbox" },
    });
  });
});


describe("detect unregistered path or candidate helper", () => {
  it("detects tilde relative paths", () => {
    const result = detectUnregisteredPathOrCandidate(
      "continue capstone at ~/Projects/Capstone with deliverable auth",
    );
    expect(result).toEqual({
      candidateAlias: "Capstone",
      candidatePath: "~/Projects/Capstone",
    });
  });

  it("detects windows drive paths", () => {
    const result = detectUnregisteredPathOrCandidate(
      "work on project at C:/repos/nlp/classifier please",
    );
    expect(result).toEqual({
      candidateAlias: "classifier",
      candidatePath: "C:/repos/nlp/classifier",
    });
  });

  it("detects project names mentioned after continue or project", () => {
    const result = detectUnregisteredPathOrCandidate("continue capstone project");
    expect(result).toEqual({
      candidateAlias: "capstone",
    });
  });

  it("returns null when no candidate or path pattern is present", () => {
    expect(detectUnregisteredPathOrCandidate("hello world")).toBeNull();
    expect(detectUnregisteredPathOrCandidate("   ")).toBeNull();
  });

  it("filters out stop words like needs from project phrase matches", () => {
    expect(
      detectUnregisteredPathOrCandidate(
        "My sandbox project needs a new AGENTS.md so can we set up the brief for that?",
      ),
    ).toBeNull();
  });
});

