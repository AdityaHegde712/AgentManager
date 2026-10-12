import { describe, expect, it } from "vitest";

import { generateConversationMarkdown } from "../../src/client/export-markdown.js";

describe("generateConversationMarkdown", () => {
  it("formats codex-style conversation markdown with headers and metadata block", () => {
    const timestamp = "2026-10-11T18:00:00.000Z";
    const markdown = generateConversationMarkdown({
      threadId: "test-thread-123",
      projectAlias: "alpha",
      projectRoot: "/workspace/alpha",
      timestamp,
      messages: [
        {
          id: "msg-1",
          role: "user",
          text: "Implement authentication service with JWT",
        },
        {
          id: "msg-2",
          role: "assistant",
          text: "Draft prepared",
          card: {
            type: "brief",
            brief: {
              provider_id: "openrouter",
              model: "openrouter/free",
              evidence: [],
              content: "### Continuation Brief\nImplement JWT tokens and middleware.",
            },
          },
        },
      ],
    });

    // Level 1 header
    expect(markdown).toContain(`# AgentRunner Conversation - ${timestamp}`);

    // Metadata block
    expect(markdown).toContain("- Thread ID: test-thread-123");
    expect(markdown).toContain("- Project Alias: alpha");
    expect(markdown).toContain("- Root: /workspace/alpha");
    expect(markdown).toContain(`- Timestamp: ${timestamp}`);

    // Level 2 headers
    expect(markdown).toContain("## User");
    expect(markdown).toContain("Implement authentication service with JWT");
    expect(markdown).toContain("## Agent");
    expect(markdown).toContain("### Continuation Brief\nImplement JWT tokens and middleware.");
  });

  it("handles empty project and fallback card descriptions", () => {
    const timestamp = "2026-10-11T19:00:00.000Z";
    const markdown = generateConversationMarkdown({
      threadId: "empty-thread",
      timestamp,
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          text: "Welcome",
          card: {
            type: "rules",
            threadScope: "none",
          },
        },
      ],
    });

    expect(markdown).toContain("- Project Alias: none");
    expect(markdown).toContain("- Root: none");
    expect(markdown).toContain("## Agent");
    expect(markdown).toContain("Welcome");
  });
});
