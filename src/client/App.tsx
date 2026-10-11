import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentRunnerApi, type Brief, type ProjectAlias, type ProviderSnapshot } from "./api.js";
import {
  detectUnregisteredPathOrCandidate,
  inferProject,
  type ProjectInferenceResult,
} from "./project-inference.js";
import { TerminalPanel } from "./TerminalPanel.js";
import { resolveThreadProject } from "./thread-context.js";


const api = new AgentRunnerApi();


type ChatCard =
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


type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text?: string;
  card?: ChatCard;
};


const EPHEMERAL_PROGRESS_STEPS = [
  "Resolving project...",
  "Scanning repository context...",
  "Reading HANDOFF.md...",
  "Running git status...",
  "Synthesizing brief with OpenRouter...",
];


export function App(): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderSnapshot[]>([]);
  const [projects, setProjects] = useState<ProjectAlias[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("openrouter");
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [requestedProjectAlias, setRequestedProjectAlias] = useState(
    () => new URLSearchParams(window.location.search).get("project"),
  );
  const [alias, setAlias] = useState("");
  const [root, setRoot] = useState("");
  const [deliverable, setDeliverable] = useState("");
  const [handoff, setHandoff] = useState("");
  const [stateDocumentText, setStateDocumentText] = useState("");
  const [transcript, setTranscript] = useState("");
  const [gitStatus, setGitStatus] = useState("");
  const [approvedBrief, setApprovedBrief] = useState<string>();
  const [terminalId, setTerminalId] = useState<string>();
  const [message, setMessage] = useState("Refreshing local provider status.");
  const [confirmedProject, setConfirmedProject] = useState<ProjectAlias>();
  const [inspectedAlias, setInspectedAlias] = useState<string>();
  const [ephemeralStatus, setEphemeralStatus] = useState<string | null>(null);
  const [renamingAlias, setRenamingAlias] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const duplicateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerDuplicateNotice = useCallback(() => {
    if (duplicateTimerRef.current) {
      clearTimeout(duplicateTimerRef.current);
    }
    setDuplicateNotice("One or more duplicates were attempted to be added and were ignored.");
    duplicateTimerRef.current = setTimeout(() => {
      setDuplicateNotice(null);
      duplicateTimerRef.current = null;
    }, 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (duplicateTimerRef.current) {
        clearTimeout(duplicateTimerRef.current);
      }
    };
  }, []);

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const threadProject = useMemo(
    () => resolveThreadProject(projects, requestedProjectAlias),
    [projects, requestedProjectAlias],
  );

  const effectiveProject = confirmedProject ?? threadProject;

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: "initial-welcome",
      role: "assistant",
      text: "Describe the next deliverable below. I will prepare a reviewable continuation brief; general assistant chat is deferred to vNext.",
      card: {
        type: "rules",
        threadScope: "project registration required",
      },
    },
  ]);

  const terminalUrl = useMemo(
    () => (terminalId ? api.terminalUrl(terminalId) : undefined),
    [terminalId],
  );

  const refresh = useCallback(async () => {
    try {
      const [nextProviders, nextProjects] = await Promise.all([api.refreshProviders(), api.projects()]);
      setProviders(nextProviders);
      setProjects(nextProjects);
      setMessage("Local control plane is ready.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to reach the local control plane.");
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refresh());
  }, [refresh]);

  useEffect(() => {
    queueMicrotask(() => {
      if (selectedProvider?.status !== "healthy") {
        setModels([]);
        setSelectedModel("");
        return;
      }

      void api.models(selectedProvider.id)
        .then((nextModels) => {
          setModels(nextModels);
          setSelectedModel(nextModels[0]?.id ?? "");
        })
        .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unable to load models."));
    });
  }, [selectedProvider]);

  useEffect(() => {
    const updateThreadScope = () => {
      const paramAlias = new URLSearchParams(window.location.search).get("project");
      setRequestedProjectAlias(paramAlias);
    };

    window.addEventListener("popstate", updateThreadScope);
    return () => window.removeEventListener("popstate", updateThreadScope);
  }, []);

  const attachProjectToThread = (project: ProjectAlias): void => {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("project", project.alias);
    window.history.pushState({}, "", nextUrl);
    setRequestedProjectAlias(project.alias);
    setConfirmedProject(project);
  };

  const addProject = async (): Promise<void> => {
    try {
      const result = await api.addProject(alias, root);
      if (result.duplicate_ignored) {
        triggerDuplicateNotice();
        setMessage(`Project already registered as ${result.project.alias}. Duplicate ignored.`);
        return;
      }
      setProjects((current) => [...current.filter((item) => item.alias !== result.project.alias), result.project]);
      attachProjectToThread(result.project);
      setAlias("");
      setRoot("");
      setMessage(`Registered ${result.project.alias} and attached it to this thread.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to register project.");
    }
  };

  const handleBrowseFolder = async (): Promise<void> => {
    try {
      const result = await api.browseFolder();
      if (!result.canceled && result.path) {
        setRoot(result.path);
        if (!alias.trim()) {
          const folderName = result.path.split(/[/\\]/).filter(Boolean).pop() ?? "";
          if (folderName) {
            setAlias(folderName);
          }
        }
        setMessage(`Selected directory: ${result.path}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Folder picker failed.");
    }
  };

  const runWithProgress = async <T,>(action: () => Promise<T>): Promise<T> => {
    let stepIndex = 0;
    setEphemeralStatus(EPHEMERAL_PROGRESS_STEPS[0]);
    const timer = setInterval(() => {
      stepIndex += 1;
      if (stepIndex < EPHEMERAL_PROGRESS_STEPS.length) {
        setEphemeralStatus(EPHEMERAL_PROGRESS_STEPS[stepIndex]);
      }
    }, 500);

    try {
      return await action();
    } finally {
      clearInterval(timer);
      setEphemeralStatus(null);
    }
  };

  const handleScanDirectory = async (): Promise<void> => {
    try {
      const folderResult = await api.browseFolder();
      if (!folderResult.canceled && folderResult.path) {
        setMessage(`Scanning directory: ${folderResult.path}...`);
        const scanResult = await api.scanProjects(folderResult.path);
        const updatedProjects = await api.projects();
        setProjects(updatedProjects);
        if (scanResult.duplicates.length > 0) {
          triggerDuplicateNotice();
        }
        setMessage(
          `Scanned ${scanResult.added.length} projects from ${folderResult.path}${
            scanResult.skipped.length ? ` (${scanResult.skipped.length} skipped)` : ""
          }${
            scanResult.duplicates.length ? ` (${scanResult.duplicates.length} duplicate)` : ""
          }.`,
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Directory scan failed.");
    }
  };

  const handleDeleteProject = async (aliasToDelete: string): Promise<void> => {
    if (!window.confirm(`Delete project "${aliasToDelete}" from catalog?`)) {
      return;
    }
    try {
      await api.deleteProject(aliasToDelete);
      const updatedProjects = await api.projects();
      setProjects(updatedProjects);
      if (effectiveProject?.alias === aliasToDelete) {
        setConfirmedProject(undefined);
        setRequestedProjectAlias(null);
      }
      if (inspectedAlias === aliasToDelete) {
        setInspectedAlias(undefined);
      }
      setMessage(`Deleted ${aliasToDelete} from catalog.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete project.");
    }
  };

  const handleSaveRename = async (oldAlias: string, newAlias: string): Promise<void> => {
    try {
      const updated = await api.renameProject(oldAlias, newAlias);
      const updatedProjects = await api.projects();
      setProjects(updatedProjects);
      if (effectiveProject?.alias === oldAlias) {
        attachProjectToThread(updated);
      }
      setInspectedAlias(updated.alias);
      setRenamingAlias(null);
      setMessage(`Renamed ${oldAlias} to ${updated.alias}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to rename project.");
    }
  };

  const createBriefForText = async (
    targetProject: ProjectAlias,
    deliverableText: string,
  ): Promise<Brief> => {
    return api.createBrief({
      projectAlias: targetProject.alias,
      providerId: selectedProviderId,
      model: selectedModel || "openrouter/free",
      deliverable: deliverableText,
      handoff: handoff.trim() || undefined,
      stateDocuments: stateDocumentText.trim()
        ? [{ path: "Selected .agent-tasks context", content: stateDocumentText }]
        : undefined,
      transcript: transcript.trim() || undefined,
      gitStatus: gitStatus.trim() || undefined,
    });
  };

  const handleComposerSubmit = async (): Promise<void> => {
    const promptText = deliverable.trim();
    if (!promptText) {
      return;
    }

    const userMessageId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      {
        id: userMessageId,
        role: "user",
        text: promptText,
      },
    ]);
    setDeliverable("");

    // If project is already active:
    if (effectiveProject) {
      if (selectedProvider?.status !== "healthy") {
        setMessage("Selected provider is not healthy.");
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: "Cannot draft continuation brief: provider is not healthy.",
          },
        ]);
        return;
      }

      try {
        const nextBrief = await runWithProgress(() => createBriefForText(effectiveProject, promptText));
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: "Draft continuation brief prepared. Review and approve it before opening Codex.",
            card: { type: "brief", brief: nextBrief },
          },
        ]);
        setMessage("Brief drafted. Review and approve it before enabling Codex.");
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unable to draft the brief.";
        setMessage(msg);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: `Error drafting brief: ${msg}`,
          },
        ]);
      }
      return;
    }

    // No project confirmed yet: check project inference
    const inference: ProjectInferenceResult = inferProject(promptText, projects);
    if (inference.type === "single") {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          card: {
            type: "confirm-project",
            candidate: inference.project,
            userDeliverable: promptText,
          },
        },
      ]);
      setMessage(`Found registered project ${inference.project.alias}. Please confirm to proceed.`);
      return;
    }

    if (inference.type === "multiple") {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          card: {
            type: "clarify-project",
            candidates: inference.candidates,
            userDeliverable: promptText,
          },
        },
      ]);
      setMessage("Multiple matching projects found. Select which project to use.");
      return;
    }

    // Check for unregistered path/candidate
    const unregistered = detectUnregisteredPathOrCandidate(promptText);
    if (unregistered) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          card: {
            type: "register-candidate",
            candidateAlias: unregistered.candidateAlias,
            candidatePath: unregistered.candidatePath,
            userDeliverable: promptText,
          },
        },
      ]);
      setMessage(
        `Project ${unregistered.candidateAlias} is not registered yet. Register it to continue.`,
      );
      return;
    }

    if (threadProject) {
      setConfirmedProject(threadProject);
      try {
        const nextBrief = await runWithProgress(() => createBriefForText(threadProject, promptText));
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: "Draft continuation brief prepared. Review and approve it before opening Codex.",
            card: { type: "brief", brief: nextBrief },
          },
        ]);
        setMessage("Brief drafted. Review and approve it before enabling Codex.");
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unable to draft the brief.";
        setMessage(msg);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: `Error drafting brief: ${msg}`,
          },
        ]);
      }
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        card: {
          type: "prompt-project",
          prompt:
            "No matching registered project found. Please select or register a project from the catalog at right.",
        },
      },
    ]);
    setMessage("No matching project found. Please select or register one from the catalog.");
  };

  const launchTerminal = async (): Promise<void> => {
    if (!effectiveProject) {
      setMessage("Register or confirm a project for this thread before starting Codex.");
      return;
    }

    try {
      const terminal = await api.startTerminal(effectiveProject.alias);
      setTerminalId(terminal.terminal_id);
      setMessage("Codex picker started. Select a session, then paste the approved brief when ready.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to start Codex.");
    }
  };

  const copyBrief = async (content: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(content);
      setMessage("Approved brief copied. Paste it into the live Codex terminal when ready.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The browser could not copy the approved brief.");
    }
  };

  const renderCard = (msg: ChatMessage): React.JSX.Element | null => {
    if (!msg.card) {
      return null;
    }

    const { card } = msg;

    if (card.type === "rules") {
      return (
        <section className="response-card" aria-label="Continuation preparation rules">
          <header>Continuation preparation <span>Review before terminal handoff</span></header>
          <ul>
            <li>Thread scope: <strong>{effectiveProject?.alias ?? card.threadScope}</strong></li>
            <li>Evidence order: deliverable, handoff, task state, Git status</li>
            <li>Route: OpenRouter free models - draft only</li>
          </ul>
        </section>
      );
    }

    if (card.type === "confirm-project") {
      return (
        <div className="inference-card" aria-label="Project confirmation">
          <header>Project confirmation <span>1 match found</span></header>
          <p>Found registered project <strong>{card.candidate.alias}</strong> for this handoff.</p>
          <div className="candidate-row">
            <div className="candidate-info">
              <strong>{card.candidate.alias}</strong>
              <span>{card.candidate.root}</span>
            </div>
            <div className="candidate-actions">
              <button
                className="button primary"
                onClick={async () => {
                  attachProjectToThread(card.candidate);
                  setMessages((prev) => prev.filter((m) => m.id !== msg.id));
                  try {
                    const nextBrief = await runWithProgress(() => createBriefForText(card.candidate, card.userDeliverable));
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: crypto.randomUUID(),
                        role: "assistant",
                        text: `Confirmed project ${card.candidate.alias}. Continuation brief prepared.`,
                        card: { type: "brief", brief: nextBrief },
                      },
                    ]);
                    setMessage("Brief drafted. Review and approve it before opening Codex.");
                  } catch (error) {
                    const msg = error instanceof Error ? error.message : "Unable to draft the brief.";
                    setMessage(msg);
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: crypto.randomUUID(),
                        role: "assistant",
                        text: `Error drafting brief: ${msg}`,
                      },
                    ]);
                  }
                }}
                type="button"
              >
                Confirm project
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  setMessages((prev) => prev.filter((m) => m.id !== msg.id));
                  setMessage("Please select a project from the catalog at right.");
                }}
                type="button"
              >
                Choose another
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (card.type === "clarify-project") {
      return (
        <div className="inference-card" aria-label="Project clarification">
          <header>Project clarification <span>Multiple matches</span></header>
          <p>Multiple matching projects found: Which did you mean?</p>
          <div className="candidate-list">
            {card.candidates.map((candidate) => (
              <div className="candidate-row" key={candidate.alias}>
                <div className="candidate-info">
                  <strong>{candidate.alias}</strong>
                  <span>{candidate.root}</span>
                </div>
                <div className="candidate-actions">
                  <button
                    className="button primary"
                    onClick={async () => {
                      attachProjectToThread(candidate);
                      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
                      try {
                        const nextBrief = await runWithProgress(() => createBriefForText(candidate, card.userDeliverable));
                        setMessages((prev) => [
                          ...prev,
                          {
                            id: crypto.randomUUID(),
                            role: "assistant",
                            text: `Confirmed project ${candidate.alias}. Continuation brief prepared.`,
                            card: { type: "brief", brief: nextBrief },
                          },
                        ]);
                        setMessage("Brief drafted. Review and approve it before opening Codex.");
                      } catch (error) {
                        const msg = error instanceof Error ? error.message : "Unable to draft the brief.";
                        setMessage(msg);
                      }
                    }}
                    type="button"
                  >
                    Select {candidate.alias}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (card.type === "register-candidate") {
      return (
        <div className="inference-card" aria-label="Unregistered project registration">
          <header>Project registration <span>Not registered yet</span></header>
          <p>
            Project <strong>{card.candidateAlias}</strong>
            {card.candidatePath ? <> at <strong>{card.candidatePath}</strong></> : null} is not yet registered. Would you like to register it now?
          </p>
          <div className="candidate-row">
            <div className="candidate-info">
              <strong>{card.candidateAlias}</strong>
              <span>{card.candidatePath ?? "Path required - register via catalog"}</span>
            </div>
            <div className="candidate-actions">
              <button
                className="button primary"
                onClick={async () => {
                  if (!card.candidatePath) {
                    setAlias(card.candidateAlias);
                    setMessage(`Please enter folder path for ${card.candidateAlias} in catalog.`);
                    return;
                  }
                  setMessages((prev) => prev.filter((m) => m.id !== msg.id));
                  try {
                    const result = await api.addProject(card.candidateAlias, card.candidatePath);
                    if (result.duplicate_ignored) {
                      triggerDuplicateNotice();
                    }
                    setProjects((current) => [...current.filter((item) => item.alias !== result.project.alias), result.project]);
                    attachProjectToThread(result.project);
                    const nextBrief = await runWithProgress(() => createBriefForText(result.project, card.userDeliverable));
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: crypto.randomUUID(),
                        role: "assistant",
                        text: `Registered and attached ${result.project.alias}. Continuation brief prepared.`,
                        card: { type: "brief", brief: nextBrief },
                      },
                    ]);
                    setMessage("Project registered and brief drafted.");
                  } catch (error) {
                    const msg = error instanceof Error ? error.message : "Unable to register project.";
                    setMessage(msg);
                  }
                }}
                type="button"
              >
                Register and continue
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  setMessages((prev) => prev.filter((m) => m.id !== msg.id));
                  setMessage("Registration canceled.");
                }}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (card.type === "prompt-project") {
      return (
        <div className="inference-card" aria-label="Project selection prompt">
          <header>Project selection <span>Action needed</span></header>
          <p>{card.prompt}</p>
        </div>
      );
    }

    if (card.type === "brief") {
      return (
        <BriefCard
          approvedBrief={approvedBrief}
          brief={card.brief}
          effectiveProject={effectiveProject}
          onApprove={(content) => {
            setApprovedBrief(content);
            setMessage("Brief approved and locked for your terminal handoff.");
          }}
          onContentChange={(nextContent) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msg.id && m.card?.type === "brief"
                  ? { ...m, card: { ...m.card, brief: { ...m.card.brief, content: nextContent } } }
                  : m,
              ),
            );
          }}
          onCopy={(content) => void copyBrief(content)}
          onLaunchTerminal={() => void launchTerminal()}
          terminalId={terminalId}
        />
      );
    }

    return null;
  };

  return (
    <>
      {duplicateNotice && (
        <div className="duplicate-banner" role="alert">
          <span>{duplicateNotice}</span>
          <button
            aria-label="Dismiss notification"
            className="duplicate-banner-dismiss"
            onClick={() => {
              if (duplicateTimerRef.current) {
                clearTimeout(duplicateTimerRef.current);
                duplicateTimerRef.current = null;
              }
              setDuplicateNotice(null);
            }}
            type="button"
          >
            ×
          </button>
        </div>
      )}
      <main className="chat-shell">
      <aside className="thread-rail" aria-label="Assistant thread history">
        <p className="eyebrow">LOCAL CODING-AGENT HUB</p>
        <h1 className="brand">AgentRunner</h1>
        <button className="new-thread" type="button">+ New orchestration thread</button>
        <nav className="history" aria-label="Recent threads">
          <h2>Recent</h2>
          <div className="thread active">
            Continuation workspace
            <small>Scope: {effectiveProject?.alias ?? "not attached"}</small>
          </div>
          <div className="thread">
            New orchestration thread
            <small>Project scope is declared per thread</small>
          </div>
        </nav>
      </aside>

      <section className="chat-column" aria-label="Assistant orchestration thread">
        <header className="chat-header">
          <div>
            <h1>Continuation workspace</h1>
            <p>Persistent orchestration thread; every terminal action declares its project scope.</p>
          </div>
          <span className="local-control">LOCAL CONTROL PLANE</span>
        </header>

        <div className="chat-feed-wrap">
          <div className="chat-feed">
            <p className="date-divider">v0.1</p>
            {messages.map((msg) => (
              <article
                className={`message-card ${msg.role === "user" ? "user-message" : "assistant-message"}`}
                key={msg.id}
              >
                <div className={`avatar ${msg.role === "user" ? "user" : ""}`}>
                  {msg.role === "user" ? "Y" : "AR"}
                </div>
                <div>
                  <MessageHeader name={msg.role === "user" ? "You" : "AgentRunner"} />
                  {msg.text && <p>{msg.text}</p>}
                  {renderCard(msg)}
                </div>
              </article>
            ))}

            {ephemeralStatus && (
              <article className="message-card assistant-message ephemeral-progress" aria-label="Ephemeral progress">
                <div className="avatar">AR</div>
                <div>
                  <MessageHeader name="AgentRunner" />
                  <div className="progress-badge">
                    <span className="pulse-dot" />
                    <span className="progress-text">{ephemeralStatus}</span>
                  </div>
                </div>
              </article>
            )}

            <section className="work-surface" aria-label="Live coding terminal">
              <header><h2>Embedded work surface</h2><p>One project terminal attached to this thread. You own the input after launch.</p></header>
              <TerminalPanel onExit={() => { setTerminalId(undefined); setMessage("Codex terminal exited."); }} terminalUrl={terminalUrl} />
            </section>
          </div>
        </div>

        <form className="composer" onSubmit={(event) => { event.preventDefault(); void handleComposerSubmit(); }}>
          <div className="compose-box">
            <textarea
              id="deliverable"
              aria-label="Requested deliverable"
              onChange={(event) => setDeliverable(event.target.value)}
              placeholder="Describe the next deliverable or ask about any project..."
              value={deliverable}
            />
            <div className="compose-actions">
              <span className="scope">
                Scope: {effectiveProject?.alias ?? "registration required"} - Context packet at right
              </span>
              <button
                className="button primary"
                disabled={!deliverable.trim()}
                type="submit"
              >
                {effectiveProject ? "Draft continuation brief" : "Prepare handoff"}
              </button>
            </div>
          </div>
        </form>
      </section>

      <aside className="context-rail" aria-label="Context and provider controls">
        <div className="context-heading">
          <h2>Request controls</h2>
          <button className="button ghost" onClick={() => void refresh()} type="button">Refresh status</button>
        </div>

        <Panel title="Project catalog" detail="Registered workspaces available for coding handoff.">
          <div className="scope-card">
            <strong>{effectiveProject?.alias ?? "No project attached"}</strong>
            <span>{effectiveProject?.root ?? "Register or select a project to make a terminal available."}</span>
          </div>

          <div className="catalog-actions-bar">
            <button
              className="button secondary compact"
              onClick={() => void handleScanDirectory()}
              type="button"
            >
              Scan Directory...
            </button>
          </div>

          <div className="project-catalog-list">
            {projects.map((project) => {
              const isCurrent = effectiveProject?.alias === project.alias;
              const isInspected = inspectedAlias === project.alias;
              const isRenaming = renamingAlias === project.alias;
              return (
                <div key={project.alias} className={`project-row-wrap ${isCurrent ? "current" : ""}`}>
                  <button
                    className={`project-row ${isCurrent ? "active" : ""}`}
                    onClick={() => {
                      setInspectedAlias(isInspected ? undefined : project.alias);
                      setRenamingAlias(null);
                    }}
                    type="button"
                  >
                    <span>{project.alias}</span>
                    <small>{isCurrent ? "current target" : "registered"}</small>
                  </button>
                  {isInspected && (
                    <div className="project-inspector">
                      <div className="inspector-field">
                        <span className="inspector-label">Alias:</span>
                        <strong>{project.alias}</strong>
                      </div>
                      <div className="inspector-field">
                        <span className="inspector-label">Root:</span>
                        <code className="inspector-path">{project.root}</code>
                      </div>
                      {isRenaming ? (
                        <div className="inspector-rename-form">
                          <input
                            aria-label="New project alias"
                            className="inspector-rename-input"
                            onChange={(e) => setRenameValue(e.target.value)}
                            placeholder="New alias"
                            value={renameValue}
                          />
                          <button
                            className="button primary compact"
                            disabled={!renameValue.trim() || renameValue.trim().toLowerCase() === project.alias}
                            onClick={() => void handleSaveRename(project.alias, renameValue.trim())}
                            type="button"
                          >
                            Save
                          </button>
                          <button
                            className="button ghost compact"
                            onClick={() => setRenamingAlias(null)}
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="inspector-actions">
                          {!isCurrent && (
                            <button
                              className="button secondary compact"
                              onClick={() => {
                                attachProjectToThread(project);
                                setMessage(`Set ${project.alias} as current target.`);
                              }}
                              type="button"
                            >
                              Set target
                            </button>
                          )}
                          <button
                            className="button secondary compact"
                            onClick={() => {
                              setRenamingAlias(project.alias);
                              setRenameValue(project.alias);
                            }}
                            type="button"
                          >
                            Rename
                          </button>
                          <button
                            className="button danger compact"
                            onClick={() => void handleDeleteProject(project.alias)}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {!projects.length && <p className="muted">No registered projects yet.</p>}
          </div>

          <details className="registration-details">
            <summary>Register a project</summary>
            <div className="form-stack compact">
              <input
                aria-label="Project alias"
                onChange={(event) => setAlias(event.target.value)}
                placeholder="Project name or alias"
                value={alias}
              />
              <div className="browse-row">
                <input
                  aria-label="Project root"
                  onChange={(event) => setRoot(event.target.value)}
                  placeholder="Absolute project root"
                  value={root}
                />
                <button
                  className="button secondary browse-button"
                  onClick={() => void handleBrowseFolder()}
                  type="button"
                >
                  Browse...
                </button>
              </div>
              <div className="catalog-form-buttons">
                <button
                  className="button secondary"
                  disabled={!alias.trim() || !root.trim()}
                  onClick={() => void addProject()}
                  type="button"
                >
                  Add to catalog
                </button>
                <button
                  className="button secondary"
                  onClick={() => void handleScanDirectory()}
                  type="button"
                >
                  Scan Directory...
                </button>
              </div>
            </div>
          </details>
        </Panel>

        <Panel title="Provider route" detail="Only healthy providers can draft a continuation brief.">
          <div className="provider-list">
            {providers.map((provider) => (
              <label className={`provider-option ${provider.status === "healthy" ? "healthy" : ""}`} key={provider.id}>
                <input checked={selectedProviderId === provider.id} disabled={provider.status !== "healthy"} name="provider" onChange={() => setSelectedProviderId(provider.id)} type="radio" />
                <span>{provider.label}</span><StatusBadge status={provider.status} />
              </label>
            ))}
            {!providers.length && <p className="muted">No provider status returned yet.</p>}
          </div>
          <label className="field-label" htmlFor="model">Free route or fixed free model</label>
          <select id="model" disabled={!models.length} onChange={(event) => setSelectedModel(event.target.value)} value={selectedModel}>
            <option value="">Choose a healthy provider first</option>
            {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
          </select>
        </Panel>

        <Panel title="Context packet" detail="Auto-discovered from project: HANDOFF.md, .agent-tasks/, git status.">
          <details>
            <summary>Manual overrides (optional)</summary>
            <label className="field-label" htmlFor="handoff">HANDOFF.md contents</label>
            <textarea id="handoff" onChange={(event) => setHandoff(event.target.value)} placeholder="Auto-discovered if empty; override here" value={handoff} />
            <label className="field-label" htmlFor="state-documents">.agent-tasks state documents</label>
            <textarea id="state-documents" onChange={(event) => setStateDocumentText(event.target.value)} placeholder="Auto-discovered if empty; override here" value={stateDocumentText} />
            <label className="field-label" htmlFor="transcript">Codex transcript fallback</label>
            <textarea id="transcript" onChange={(event) => setTranscript(event.target.value)} placeholder="Used only when no handoff or state document is supplied" value={transcript} />
            <label className="field-label" htmlFor="git-status">Current Git status</label>
            <textarea id="git-status" onChange={(event) => setGitStatus(event.target.value)} placeholder="Auto-discovered if empty; override here" value={gitStatus} />
          </details>
        </Panel>

        <Panel title="Work surface" detail="The terminal is a project surface, never a second assistant.">
          <div className="terminal-state"><strong>Embedded terminal - v0.1</strong><span>{terminalId ? "Live terminal attached" : "Launch after brief approval"}</span></div>
          <p className="future-note">vNext: a user-triggered pop-out browser window authenticated to this same PTY.</p>
          <p className="control-message" role="status"><span className="pulse" />{message}</p>
        </Panel>
      </aside>
    </main>
    </>
  );
}


type BriefCardProps = {
  brief: Brief;
  approvedBrief?: string;
  effectiveProject?: ProjectAlias;
  terminalId?: string;
  onApprove: (content: string) => void;
  onCopy: (content: string) => void;
  onLaunchTerminal: () => void;
  onContentChange: (nextContent: string) => void;
};


function BriefCard({
  brief,
  approvedBrief,
  effectiveProject,
  terminalId,
  onApprove,
  onCopy,
  onLaunchTerminal,
  onContentChange,
}: BriefCardProps): React.JSX.Element {
  const fullContentRef = useRef(brief.content);
  useEffect(() => {
    fullContentRef.current = brief.content;
  }, [brief.content]);

  // Tokenize preserving all whitespace (\S+\s* matches words with trailing whitespace, \s+ matches whitespace-only chunks)
  const [displayedText, setDisplayedText] = useState(() => {
    const initialTokens = brief.content.match(/\S+\s*|\s+/g) || [brief.content];
    if (initialTokens.length <= 1) {
      return brief.content;
    }
    return initialTokens[0] ?? "";
  });

  const [isStreaming, setIsStreaming] = useState(() => {
    const initialTokens = brief.content.match(/\S+\s*|\s+/g) || [brief.content];
    return initialTokens.length > 1;
  });

  const tokenIndexRef = useRef(1);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasStartedRef = useRef(false);

  const flushStreaming = useCallback(() => {
    if (streamTimerRef.current) {
      clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    setIsStreaming(false);
    setDisplayedText(fullContentRef.current);
  }, []);

  useEffect(() => {
    if (hasStartedRef.current) {
      return;
    }
    hasStartedRef.current = true;

    const tokens = fullContentRef.current.match(/\S+\s*|\s+/g) || [fullContentRef.current];
    if (tokens.length <= 1) {
      setIsStreaming(false);
      setDisplayedText(fullContentRef.current);
      return;
    }

    tokenIndexRef.current = 1;
    streamTimerRef.current = setInterval(() => {
      tokenIndexRef.current += 1;
      if (tokenIndexRef.current >= tokens.length) {
        if (streamTimerRef.current) {
          clearInterval(streamTimerRef.current);
          streamTimerRef.current = null;
        }
        setIsStreaming(false);
        setDisplayedText(fullContentRef.current);
      } else {
        setDisplayedText(tokens.slice(0, tokenIndexRef.current).join(""));
      }
    }, 10);

    return () => {
      if (streamTimerRef.current) {
        clearInterval(streamTimerRef.current);
        streamTimerRef.current = null;
      }
    };
  }, []);

  const handleApprove = () => {
    flushStreaming();
    onApprove(fullContentRef.current);
  };

  const lineCount = (brief.content || displayedText).split("\n").length;

  return (
    <section
      className="response-card uncompressed"
      aria-label="Draft continuation brief"
      onClick={() => {
        if (isStreaming) {
          flushStreaming();
        }
      }}
    >
      <header>
        Approval gate <span>Draft only</span>
      </header>
      <div className="approval-content">
        <div className="evidence-chips">
          {brief.evidence.map((item) => (
            <span key={`${item.kind}:${item.label}`}>{item.label}</span>
          ))}
        </div>
        <textarea
          aria-label="Draft continuation brief"
          className="brief uncompressed"
          rows={Math.max(12, lineCount + 2)}
          onFocus={() => {
            if (isStreaming) {
              flushStreaming();
            }
          }}
          onKeyDown={() => {
            if (isStreaming) {
              flushStreaming();
            }
          }}
          onChange={(event) => {
            flushStreaming();
            const nextVal = event.target.value;
            fullContentRef.current = nextVal;
            setDisplayedText(nextVal);
            onContentChange(nextVal);
          }}
          value={displayedText}
        />
        <div className="button-row">
          <button className="button primary" onClick={handleApprove} type="button">
            Approve brief
          </button>
          <button
            className="button secondary"
            disabled={approvedBrief !== brief.content}
            onClick={() => void onCopy(fullContentRef.current)}
            type="button"
          >
            Copy approved brief
          </button>
          <button
            className="button secondary"
            disabled={approvedBrief !== brief.content || !effectiveProject || Boolean(terminalId)}
            onClick={onLaunchTerminal}
            type="button"
          >
            Launch Codex picker
          </button>
        </div>
      </div>
    </section>
  );
}


function Panel({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }): React.JSX.Element {
  return <section className="context-card"><header><h3>{title}</h3><p>{detail}</p></header>{children}</section>;
}


function StatusBadge({ status }: { status: string }): React.JSX.Element {
  return <span className={`status-badge ${status}`}>{status}</span>;
}


function MessageHeader({ name }: { name: string }): React.JSX.Element {
  return <header className="message-header"><strong>{name}</strong><time>Current thread</time></header>;
}
