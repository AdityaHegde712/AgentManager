import type { Brief, ProjectAlias } from "./api.js";

export type ChatCard =
  | {
      type: "rules";
      threadScope: string;
    }
  | {
      type: "confirm-project";
      candidate: ProjectAlias;
      userDeliverable: string;
    }
  | {
      type: "clarify-project";
      candidates: ProjectAlias[];
      userDeliverable: string;
    }
  | {
      type: "register-candidate";
      candidateAlias: string;
      candidatePath?: string;
      userDeliverable: string;
    }
  | {
      type: "prompt-project";
      prompt: string;
    }
  | {
      type: "brief";
      brief: Brief;
    };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text?: string;
  card?: ChatCard;
};

export function generateConversationMarkdown(params: {
  threadId: string;
  projectAlias?: string;
  projectRoot?: string;
  timestamp: string;
  messages: ChatMessage[];
}): string {
  const { threadId, projectAlias, projectRoot, timestamp, messages } = params;
  const lines: string[] = [];

  // Level 1 header
  lines.push(`# AgentRunner Conversation - ${timestamp}`);
  lines.push("");

  // Metadata block
  lines.push(`- Thread ID: ${threadId}`);
  lines.push(`- Project Alias: ${projectAlias ?? "none"}`);
  lines.push(`- Root: ${projectRoot ?? "none"}`);
  lines.push(`- Timestamp: ${timestamp}`);
  lines.push("");

  // Level 2 headers
  for (const msg of messages) {
    if (msg.role === "user") {
      lines.push("## User");
      lines.push("");
      let userQuery = msg.text ?? "";
      if (!userQuery && msg.card && "userDeliverable" in msg.card) {
        userQuery = msg.card.userDeliverable;
      }
      lines.push(userQuery);
      lines.push("");
    } else {
      lines.push("## Agent");
      lines.push("");
      let content = msg.text ?? "";
      if (msg.card?.type === "brief") {
        content = msg.card.brief.content || content;
      } else if (!content && msg.card) {
        if (msg.card.type === "rules") {
          content = `Continuation preparation rules (scope: ${msg.card.threadScope})`;
        } else if (msg.card.type === "confirm-project") {
          content = `Project confirmation for ${msg.card.candidate.alias}`;
        } else if (msg.card.type === "clarify-project") {
          content = `Project clarification (${msg.card.candidates.map((c) => c.alias).join(", ")})`;
        } else if (msg.card.type === "register-candidate") {
          content = `Project registration candidate: ${msg.card.candidateAlias}`;
        } else if (msg.card.type === "prompt-project") {
          content = msg.card.prompt;
        }
      }
      lines.push(content);
      lines.push("");
    }
  }

  return lines.join("\n");
}
