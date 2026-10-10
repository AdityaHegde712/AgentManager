export type SelectedStateDocument = {
  path: string;
  content: string;
};


export type EvidenceInput = {
  deliverable: string;
  handoff?: string;
  stateDocuments: SelectedStateDocument[];
  transcript?: string;
  gitStatus?: string;
};


export type EvidenceItem = {
  kind: "deliverable" | "handoff" | "state_document" | "transcript" | "git_status";
  label: string;
  content: string;
};


export function assembleEvidence(input: EvidenceInput): EvidenceItem[] {
  const evidence: EvidenceItem[] = [{ kind: "deliverable", label: "Requested deliverable", content: input.deliverable }];
  const hasHandoff = Boolean(input.handoff?.trim());
  const hasStateDocuments = input.stateDocuments.length > 0;

  if (hasHandoff) {
    evidence.push({ kind: "handoff", label: "Selected HANDOFF.md", content: input.handoff!.trim() });
  }
  for (const document of input.stateDocuments) {
    evidence.push({ kind: "state_document", label: document.path, content: document.content });
  }
  if (!hasHandoff && !hasStateDocuments && input.transcript?.trim()) {
    evidence.push({ kind: "transcript", label: "Selected Codex transcript", content: input.transcript.trim() });
  }
  if (input.gitStatus?.trim()) {
    evidence.push({ kind: "git_status", label: "Current Git status", content: input.gitStatus.trim() });
  }

  return evidence;
}


export function formatEvidenceForBrief(evidence: EvidenceItem[]): string {
  return evidence.map((item) => `## ${item.label}\n${item.content}`).join("\n\n");
}
