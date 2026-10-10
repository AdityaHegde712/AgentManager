import { describe, expect, it } from "vitest";

import { assembleEvidence } from "../../src/server/evidence/assemble-evidence.js";


describe("evidence assembly", () => {
  it("prefers selected project handoff material over the transcript", () => {
    const evidence = assembleEvidence({
      deliverable: "Add a provider selector.",
      handoff: "The current state is safe to extend.",
      stateDocuments: [{ path: ".agent-tasks/TASKS.md", content: "Task 3 is active." }],
      transcript: "Older Codex transcript.",
      gitStatus: "## feature/provider",
    });

    expect(evidence.map((item) => item.kind)).toEqual([
      "deliverable",
      "handoff",
      "state_document",
      "git_status",
    ]);
  });

  it("uses the transcript only when no handoff or state document is selected", () => {
    const evidence = assembleEvidence({
      deliverable: "Fix the failing test.",
      stateDocuments: [],
      transcript: "The test failed in provider setup.",
      gitStatus: "## dev",
    });

    expect(evidence.map((item) => item.kind)).toEqual([
      "deliverable",
      "transcript",
      "git_status",
    ]);
  });
});
