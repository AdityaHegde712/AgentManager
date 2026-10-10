import { useCallback, useEffect, useMemo, useState } from "react";

import { AgentRunnerApi, type Brief, type ProjectAlias, type ProviderSnapshot } from "./api.js";
import { inferProject, type ProjectInferenceResult } from "./project-inference.js";
import { TerminalPanel } from "./TerminalPanel.js";
import { resolveThreadProject } from "./thread-context.js";


const api = new AgentRunnerApi();


type InferenceState =
  | { status: "idle" }
  | { status: "single"; candidate: ProjectAlias }
  | { status: "multiple"; candidates: ProjectAlias[] }
  | { status: "none"; prompt: string };


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
  const [brief, setBrief] = useState<Brief>();
  const [approvedBrief, setApprovedBrief] = useState<string>();
  const [terminalId, setTerminalId] = useState<string>();
  const [message, setMessage] = useState("Refreshing local provider status.");
  const [inferenceState, setInferenceState] = useState<InferenceState>({ status: "idle" });
  const [confirmedProject, setConfirmedProject] = useState<ProjectAlias>();
  const [inspectedAlias, setInspectedAlias] = useState<string>();

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const threadProject = useMemo(
    () => resolveThreadProject(projects, requestedProjectAlias),
    [projects, requestedProjectAlias],
  );

  const effectiveProject = confirmedProject ?? threadProject;
  const canDraft =
    selectedProvider?.status === "healthy" &&
    Boolean(selectedModel) &&
    Boolean(deliverable.trim()) &&
    Boolean(effectiveProject);

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
    setInferenceState({ status: "idle" });
  };

  const addProject = async (): Promise<void> => {
    try {
      const project = await api.addProject(alias, root);
      setProjects((current) => [...current.filter((item) => item.alias !== project.alias), project]);
      attachProjectToThread(project);
      setAlias("");
      setRoot("");
      setMessage(`Registered ${project.alias} and attached it to this thread.`);
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

  const draftBrief = async (): Promise<void> => {
    if (!canDraft || !effectiveProject) {
      return;
    }

    try {
      const nextBrief = await api.createBrief({
        providerId: selectedProviderId,
        model: selectedModel,
        deliverable,
        handoff: handoff || undefined,
        stateDocuments: stateDocumentText.trim()
          ? [{ path: "Selected .agent-tasks context", content: stateDocumentText }]
          : [],
        transcript: transcript || undefined,
        gitStatus: gitStatus || undefined,
      });
      setBrief(nextBrief);
      setApprovedBrief(undefined);
      setMessage("Brief drafted. Review it before enabling Codex.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to draft the brief.");
    }
  };

  const handleComposerSubmit = async (): Promise<void> => {
    const text = deliverable.trim();
    if (!text) {
      return;
    }

    if (effectiveProject) {
      await draftBrief();
      return;
    }

    const inference: ProjectInferenceResult = inferProject(text, projects);
    if (inference.type === "single") {
      setInferenceState({ status: "single", candidate: inference.project });
      setMessage(`Found registered project ${inference.project.alias}. Please confirm to proceed.`);
    } else if (inference.type === "multiple") {
      setInferenceState({ status: "multiple", candidates: inference.candidates });
      setMessage("Multiple matching projects found. Select which project to use.");
    } else {
      if (threadProject) {
        setConfirmedProject(threadProject);
        await draftBrief();
      } else {
        setInferenceState({
          status: "none",
          prompt: "No matching registered project found. Please select or register a project from the catalog.",
        });
        setMessage("No matching project found. Please select or register one from the catalog.");
      }
    }
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

  const copyBrief = async (): Promise<void> => {
    if (!approvedBrief) {
      return;
    }

    try {
      await navigator.clipboard.writeText(approvedBrief);
      setMessage("Approved brief copied. Paste it into the live Codex terminal when you choose.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The browser could not copy the approved brief.");
    }
  };

  return (
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
            <article className="message-card assistant-message">
              <div className="avatar">AR</div>
              <div>
                <MessageHeader name="AgentRunner" />
                <p>Describe the next deliverable below. I will prepare a reviewable continuation brief; general assistant chat is deferred to vNext.</p>
                <section className="response-card" aria-label="Continuation preparation rules">
                  <header>Continuation preparation <span>Review before terminal handoff</span></header>
                  <ul>
                    <li>Thread scope: <strong>{effectiveProject?.alias ?? "project registration required"}</strong></li>
                    <li>Evidence order: deliverable, handoff, task state, Git status</li>
                    <li>Route: OpenRouter free models - draft only</li>
                  </ul>
                </section>
              </div>
            </article>

            {deliverable.trim() && (
              <article className="message-card user-message">
                <div className="avatar user">Y</div>
                <div><MessageHeader name="You" /><p>{deliverable}</p></div>
              </article>
            )}

            {inferenceState.status === "single" && (
              <article className="message-card assistant-message">
                <div className="avatar">AR</div>
                <div>
                  <MessageHeader name="AgentRunner" />
                  <div className="inference-card" aria-label="Project confirmation">
                    <header>Project confirmation <span>1 match found</span></header>
                    <p>Found registered project <strong>{inferenceState.candidate.alias}</strong> for this handoff.</p>
                    <div className="candidate-row">
                      <div className="candidate-info">
                        <strong>{inferenceState.candidate.alias}</strong>
                        <span>{inferenceState.candidate.root}</span>
                      </div>
                      <div className="candidate-actions">
                        <button
                          className="button primary"
                          onClick={() => {
                            attachProjectToThread(inferenceState.candidate);
                            setMessage(`Confirmed project ${inferenceState.candidate.alias}. Ready to draft continuation brief.`);
                          }}
                          type="button"
                        >
                          Confirm project
                        </button>
                        <button
                          className="button secondary"
                          onClick={() => {
                            setInferenceState({ status: "idle" });
                            setMessage("Please choose a project from the catalog at right.");
                          }}
                          type="button"
                        >
                          Choose another
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            )}

            {inferenceState.status === "multiple" && (
              <article className="message-card assistant-message">
                <div className="avatar">AR</div>
                <div>
                  <MessageHeader name="AgentRunner" />
                  <div className="inference-card" aria-label="Project clarification">
                    <header>Project clarification <span>Multiple matches</span></header>
                    <p>Multiple matching projects found: Which did you mean?</p>
                    <div className="candidate-list">
                      {inferenceState.candidates.map((candidate) => (
                        <div className="candidate-row" key={candidate.alias}>
                          <div className="candidate-info">
                            <strong>{candidate.alias}</strong>
                            <span>{candidate.root}</span>
                          </div>
                          <div className="candidate-actions">
                            <button
                              className="button primary"
                              onClick={() => {
                                attachProjectToThread(candidate);
                                setMessage(`Confirmed project ${candidate.alias}. Ready to draft continuation brief.`);
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
                </div>
              </article>
            )}

            {inferenceState.status === "none" && (
              <article className="message-card assistant-message">
                <div className="avatar">AR</div>
                <div>
                  <MessageHeader name="AgentRunner" />
                  <div className="inference-card" aria-label="Project selection prompt">
                    <header>Project selection <span>Action needed</span></header>
                    <p>{inferenceState.prompt}</p>
                  </div>
                </div>
              </article>
            )}

            {brief && (
              <article className="message-card assistant-message">
                <div className="avatar">AR</div>
                <div className="message-body">
                  <MessageHeader name="AgentRunner" />
                  <p>Draft continuation brief prepared. Review and approve it before opening Codex.</p>
                  <section className="response-card" aria-label="Draft continuation brief">
                    <header>Approval gate <span>Draft only</span></header>
                    <div className="approval-content">
                      <div className="evidence-chips">{brief.evidence.map((item) => <span key={`${item.kind}:${item.label}`}>{item.label}</span>)}</div>
                      <textarea aria-label="Draft continuation brief" className="brief" onChange={(event) => setBrief({ ...brief, content: event.target.value })} value={brief.content} />
                      <div className="button-row">
                        <button className="button primary" onClick={() => { setApprovedBrief(brief.content); setMessage("Brief approved and locked for your terminal handoff."); }} type="button">Approve brief</button>
                        <button className="button secondary" disabled={!approvedBrief} onClick={() => void copyBrief()} type="button">Copy approved brief</button>
                        <button className="button secondary" disabled={!approvedBrief || !effectiveProject || Boolean(terminalId)} onClick={() => void launchTerminal()} type="button">Launch Codex picker</button>
                      </div>
                    </div>
                  </section>
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

          <div className="project-catalog-list">
            {projects.map((project) => {
              const isCurrent = effectiveProject?.alias === project.alias;
              const isInspected = inspectedAlias === project.alias;
              return (
                <div key={project.alias} className={`project-row-wrap ${isCurrent ? "current" : ""}`}>
                  <button
                    className={`project-row ${isCurrent ? "active" : ""}`}
                    onClick={() => setInspectedAlias(isInspected ? undefined : project.alias)}
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
                      {!isCurrent && (
                        <button
                          className="button secondary compact"
                          onClick={() => {
                            attachProjectToThread(project);
                            setMessage(`Set ${project.alias} as current target.`);
                          }}
                          type="button"
                        >
                          Set as current target
                        </button>
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
              <button
                className="button secondary"
                disabled={!alias.trim() || !root.trim()}
                onClick={() => void addProject()}
                type="button"
              >
                Add to catalog
              </button>
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

        <Panel title="Context packet" detail="Paste only the evidence you want the brief writer to use.">
          <details>
            <summary>Evidence inputs</summary>
            <label className="field-label" htmlFor="handoff">HANDOFF.md contents</label>
            <textarea id="handoff" onChange={(event) => setHandoff(event.target.value)} placeholder="Optional: paste selected HANDOFF.md content" value={handoff} />
            <label className="field-label" htmlFor="state-documents">.agent-tasks state documents</label>
            <textarea id="state-documents" onChange={(event) => setStateDocumentText(event.target.value)} placeholder="Optional: paste selected plan, decisions, or tasks context" value={stateDocumentText} />
            <label className="field-label" htmlFor="transcript">Codex transcript fallback</label>
            <textarea id="transcript" onChange={(event) => setTranscript(event.target.value)} placeholder="Used only when no handoff or state document is supplied" value={transcript} />
            <label className="field-label" htmlFor="git-status">Current Git status</label>
            <textarea id="git-status" onChange={(event) => setGitStatus(event.target.value)} placeholder="Optional: paste git status output" value={gitStatus} />
          </details>
        </Panel>

        <Panel title="Work surface" detail="The terminal is a project surface, never a second assistant.">
          <div className="terminal-state"><strong>Embedded terminal - v0.1</strong><span>{terminalId ? "Live terminal attached" : "Launch after brief approval"}</span></div>
          <p className="future-note">vNext: a user-triggered pop-out browser window authenticated to this same PTY.</p>
          <p className="control-message" role="status"><span className="pulse" />{message}</p>
        </Panel>
      </aside>
    </main>
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
