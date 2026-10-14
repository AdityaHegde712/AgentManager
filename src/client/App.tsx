import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentRunnerApi, type Brief, type ProjectAlias, type ProviderSnapshot, type ThreadSummary } from "./api.js";
import {
  generateConversationMarkdown,
  type ChatMessage,
} from "./export-markdown.js";
import { TerminalPanel } from "./TerminalPanel.js";
import { resolveThreadProject } from "./thread-context.js";


const api = new AgentRunnerApi();


const EPHEMERAL_PROGRESS_STEPS = [
  "Resolving project...",
  "Scanning repository context...",
  "Reading HANDOFF.md...",
  "Running git status...",
  "Synthesizing brief with OpenRouter...",
];


function createDefaultWelcomeMessages(): ChatMessage[] {
  return [
    {
      id: "initial-welcome",
      role: "assistant",
      text: "Describe the next deliverable below. I will prepare a reviewable continuation brief; general assistant chat is deferred to vNext.",
      card: {
        type: "rules",
        threadScope: "project registration required",
      },
    },
  ];
}


export function App(): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderSnapshot[]>([]);
  const [projects, setProjects] = useState<ProjectAlias[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("openrouter");
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [requestedProjectAlias, setRequestedProjectAlias] = useState(
    () => new URLSearchParams(window.location.search).get("project"),
  );
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("thread"),
  );
  const [activeThreadTitle, setActiveThreadTitle] = useState("Continuation workspace");
  const isSwitchingThreadRef = useRef(true);

  const [alias, setAlias] = useState("");
  const [root, setRoot] = useState("");
  const [deliverable, setDeliverable] = useState("");
  const [transcript, setTranscript] = useState("");
  const [catalogExpanded, setCatalogExpanded] = useState(false);
  const [approvedBrief, setApprovedBrief] = useState<string>();
  const [terminalId, setTerminalId] = useState<string>();
  const [isLaunchModalOpen, setIsLaunchModalOpen] = useState(false);
  const [launchMode, setLaunchMode] = useState<"resume" | "new">("resume");
  const [launchModel, setLaunchModel] = useState("gpt-5.6-terra");
  const [launchReasoning, setLaunchReasoning] = useState<"low" | "medium" | "high">("medium");
  const [launchShell, setLaunchShell] = useState<"bash" | "native">("bash");
  const [message, setMessage] = useState("Refreshing local provider status.");
  const [confirmedProject, setConfirmedProject] = useState<ProjectAlias>();
  const [inspectedAlias, setInspectedAlias] = useState<string>();
  const [ephemeralStatus, setEphemeralStatus] = useState<string | null>(null);
  const [renamingAlias, setRenamingAlias] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameThreadValue, setRenameThreadValue] = useState("");
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

  const [messages, setMessages] = useState<ChatMessage[]>(() => createDefaultWelcomeMessages());

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

  const loadInitialThreads = useCallback(async () => {
    try {
      const threadList = await api.listThreads();
      setThreads(threadList);

      const params = new URLSearchParams(window.location.search);
      const urlThreadId = params.get("thread");
      const urlProjectAlias = params.get("project");

      if (urlThreadId) {
        try {
          const thread = await api.getThread<ChatMessage>(urlThreadId);
          setActiveThreadId(thread.id);
          setActiveThreadTitle(thread.title);
          if (thread.projectAlias) {
            setRequestedProjectAlias(thread.projectAlias);
          } else if (urlProjectAlias) {
            void api.updateThread(thread.id, { projectAlias: urlProjectAlias });
          }
          isSwitchingThreadRef.current = true;
          if (thread.messages && thread.messages.length > 0) {
            setMessages(thread.messages);
          } else {
            setMessages(createDefaultWelcomeMessages());
          }
          return;
        } catch {
          // If not found, fall through
        }
      }

      if (threadList.length > 0) {
        const mostRecent = threadList[0];
        const thread = await api.getThread<ChatMessage>(mostRecent.id);
        setActiveThreadId(thread.id);
        setActiveThreadTitle(thread.title);
        if (thread.projectAlias) {
          setRequestedProjectAlias(thread.projectAlias);
        } else if (urlProjectAlias) {
          void api.updateThread(thread.id, { projectAlias: urlProjectAlias });
        }
        isSwitchingThreadRef.current = true;
        if (thread.messages && thread.messages.length > 0) {
          setMessages(thread.messages);
        } else {
          setMessages(createDefaultWelcomeMessages());
        }
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("thread", thread.id);
        if (thread.projectAlias) {
          nextUrl.searchParams.set("project", thread.projectAlias);
        }
        window.history.replaceState(null, "", nextUrl);
      } else {
        const created = await api.createThread<ChatMessage>({
          title: "Continuation workspace",
          projectAlias: urlProjectAlias ?? undefined,
        });
        const summary: ThreadSummary = {
          id: created.id,
          title: created.title,
          projectAlias: created.projectAlias,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
          messageCount: 0,
        };
        setThreads([summary]);
        setActiveThreadId(created.id);
        setActiveThreadTitle(created.title);
        isSwitchingThreadRef.current = true;
        setMessages(createDefaultWelcomeMessages());
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("thread", created.id);
        window.history.replaceState(null, "", nextUrl);
      }
    } catch (error) {
      console.error("Failed to load threads:", error);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refresh());
    queueMicrotask(() => void loadInitialThreads());
  }, [refresh, loadInitialThreads]);

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

  const handleSelectThread = useCallback(async (selectedThreadId: string) => {
    if (selectedThreadId === activeThreadId) {
      return;
    }
    try {
      const thread = await api.getThread<ChatMessage>(selectedThreadId);
      setActiveThreadId(thread.id);
      setActiveThreadTitle(thread.title);
      setRequestedProjectAlias(thread.projectAlias ?? null);
      setConfirmedProject(undefined);
      setApprovedBrief(undefined);
      setTerminalId(undefined);

      isSwitchingThreadRef.current = true;
      if (thread.messages && thread.messages.length > 0) {
        setMessages(thread.messages);
      } else {
        setMessages(createDefaultWelcomeMessages());
      }

      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("thread", thread.id);
      if (thread.projectAlias) {
        nextUrl.searchParams.set("project", thread.projectAlias);
      } else {
        nextUrl.searchParams.delete("project");
      }
      window.history.pushState({}, "", nextUrl);

      const latestThreads = await api.listThreads();
      setThreads(latestThreads);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load thread.");
    }
  }, [activeThreadId]);

  const handleNewThread = useCallback(async () => {
    try {
      const activeHasUserMessage = messages.some((m) => m.role === "user");
      const activeIsUnused = activeThreadId ? !activeHasUserMessage : false;
      const unusedThread = activeIsUnused
        ? (threads.find((t) => t.id === activeThreadId) ?? (activeThreadId ? { id: activeThreadId } : null))
        : threads.find((t) => t.messageCount === 0);

      if (unusedThread) {
        if (unusedThread.id !== activeThreadId) {
          await handleSelectThread(unusedThread.id);
        }
        setMessage("Switched to existing unused orchestration thread.");
        return;
      }

      const created = await api.createThread<ChatMessage>({
        title: "New orchestration thread",
        projectAlias: requestedProjectAlias ?? undefined,
      });
      setActiveThreadId(created.id);
      setActiveThreadTitle(created.title);
      setConfirmedProject(undefined);
      setApprovedBrief(undefined);
      setTerminalId(undefined);

      isSwitchingThreadRef.current = true;
      setMessages(createDefaultWelcomeMessages());

      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("thread", created.id);
      if (created.projectAlias) {
        nextUrl.searchParams.set("project", created.projectAlias);
      } else {
        nextUrl.searchParams.delete("project");
      }
      window.history.pushState({}, "", nextUrl);

      const latestThreads = await api.listThreads();
      setThreads(latestThreads);
      setMessage("Created new orchestration thread.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create thread.");
    }
  }, [activeThreadId, messages, threads, requestedProjectAlias, handleSelectThread]);

  const handleSaveThreadRename = async (threadId: string, newTitle: string): Promise<void> => {
    const trimmedTitle = newTitle.trim();
    if (!trimmedTitle) {
      setRenamingThreadId(null);
      return;
    }
    try {
      await api.updateThread(threadId, { title: trimmedTitle });
      setThreads((current) =>
        current.map((t) => (t.id === threadId ? { ...t, title: trimmedTitle } : t)),
      );
      if (threadId === activeThreadId) {
        setActiveThreadTitle(trimmedTitle);
      }
      setRenamingThreadId(null);
      setMessage(`Renamed thread to "${trimmedTitle}".`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to rename thread.");
    }
  };

  const handleDeleteThread = async (threadId: string, title: string): Promise<void> => {
    if (!window.confirm(`Delete thread "${title}"?`)) {
      return;
    }
    try {
      await api.deleteThread(threadId);
      const remainingThreads = threads.filter((t) => t.id !== threadId);
      setThreads(remainingThreads);

      if (threadId === activeThreadId) {
        if (remainingThreads.length > 0) {
          await handleSelectThread(remainingThreads[0].id);
        } else {
          const created = await api.createThread<ChatMessage>({
            title: "Continuation workspace",
            projectAlias: requestedProjectAlias ?? undefined,
          });
          const summary: ThreadSummary = {
            id: created.id,
            title: created.title,
            projectAlias: created.projectAlias,
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
            messageCount: 0,
          };
          setThreads([summary]);
          setActiveThreadId(created.id);
          setActiveThreadTitle(created.title);
          setConfirmedProject(undefined);
          setApprovedBrief(undefined);
          setTerminalId(undefined);
          isSwitchingThreadRef.current = true;
          setMessages(createDefaultWelcomeMessages());
          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.set("thread", created.id);
          if (created.projectAlias) {
            nextUrl.searchParams.set("project", created.projectAlias);
          } else {
            nextUrl.searchParams.delete("project");
          }
          window.history.pushState({}, "", nextUrl);
        }
      }
      setMessage(`Deleted thread "${title}".`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete thread.");
    }
  };

  useEffect(() => {
    const updateThreadScope = () => {
      const params = new URLSearchParams(window.location.search);
      const paramAlias = params.get("project");
      const paramThread = params.get("thread");
      setRequestedProjectAlias(paramAlias);
      if (paramThread && paramThread !== activeThreadId) {
        void handleSelectThread(paramThread);
      }
    };

    window.addEventListener("popstate", updateThreadScope);
    return () => window.removeEventListener("popstate", updateThreadScope);
  }, [activeThreadId, handleSelectThread]);

  useEffect(() => {
    if (isSwitchingThreadRef.current) {
      isSwitchingThreadRef.current = false;
      return;
    }
    if (!activeThreadId) {
      return;
    }
    const timer = setTimeout(() => {
      void api.saveMessages(activeThreadId, messages).then(async () => {
        const latestThreads = await api.listThreads();
        setThreads(latestThreads);
      }).catch((err) => console.error("Failed to persist messages:", err));
    }, 150);
    return () => clearTimeout(timer);
  }, [messages, activeThreadId]);

  const attachProjectToThread = (project: ProjectAlias): void => {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("project", project.alias);
    window.history.pushState({}, "", nextUrl);
    setRequestedProjectAlias(project.alias);
    setConfirmedProject(project);
    if (activeThreadId) {
      void api.updateThread(activeThreadId, { projectAlias: project.alias }).then(async () => {
        const latestThreads = await api.listThreads();
        setThreads(latestThreads);
      });
    }
  };

  const handleComposerProjectChange = (chosenAlias: string): void => {
    const project = projects.find((p) => p.alias === chosenAlias);
    if (project) {
      attachProjectToThread(project);
    }
  };

  const handleExportConversation = useCallback(() => {
    const isoTimestamp = new Date().toISOString();
    const threadId = activeThreadId || "default";
    const markdown = generateConversationMarkdown({
      threadId,
      projectAlias: effectiveProject?.alias,
      projectRoot: effectiveProject?.root,
      timestamp: isoTimestamp,
      messages,
    });

    const fileTimestamp = isoTimestamp.replace(/[:.]/g, "-");
    const filename = `AgentRunner-Conversation-${threadId}-${fileTimestamp}.md`;

    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setMessage(`Exported conversation to ${filename}.`);
  }, [activeThreadId, effectiveProject, messages]);

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
      transcript: transcript.trim() || undefined,
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

    const draftBriefWithProject = async (targetProject: ProjectAlias): Promise<void> => {
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
        const nextBrief = await runWithProgress(() => createBriefForText(targetProject, promptText));
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
    };

    if (!effectiveProject) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          card: {
            type: "prompt-project",
            prompt:
              "Please select a target workspace from the composer dropdown before drafting a continuation brief.",
            userDeliverable: promptText,
          },
        },
      ]);
      setMessage("Please select a workspace from the composer dropdown.");
      return;
    }

    await draftBriefWithProject(effectiveProject);
  };

  const openLaunchModal = (): void => {
    if (!effectiveProject) {
      setMessage("Register or confirm a project for this thread before starting Codex.");
      return;
    }
    setIsLaunchModalOpen(true);
  };

  const handleConfirmLaunch = async (): Promise<void> => {
    if (!effectiveProject) {
      setMessage("Register or confirm a project for this thread before starting Codex.");
      setIsLaunchModalOpen(false);
      return;
    }

    try {
      const terminal = await api.startTerminal(effectiveProject.alias, {
        mode: launchMode,
        model: launchModel,
        reasoningEffort: launchReasoning,
        shell: launchShell,
      });
      setTerminalId(terminal.terminal_id);
      setIsLaunchModalOpen(false);
      setMessage("Codex terminal started. Paste the approved brief when ready.");
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

  const handleFallbackProjectSelect = async (
    targetAlias: string,
    cardMessageId: string,
    deliverableText?: string,
  ): Promise<void> => {
    if (!targetAlias) {
      return;
    }
    const chosenProject = projects.find((p) => p.alias === targetAlias);
    if (!chosenProject) {
      return;
    }

    setMessages((prev) => prev.filter((m) => m.id !== cardMessageId));
    attachProjectToThread(chosenProject);
    setMessage(`Selected project ${chosenProject.alias}. Drafting brief...`);

    const textToUse = deliverableText?.trim() || deliverable.trim();
    if (textToUse) {
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
        const nextBrief = await runWithProgress(() => createBriefForText(chosenProject, textToUse));
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: `Selected project ${chosenProject.alias}. Continuation brief prepared.`,
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
          <div className="card-fallback-row">
            <select
              aria-label="Select registered project"
              className="card-fallback-select"
              defaultValue=""
              onChange={(e) => {
                const targetAlias = e.target.value;
                if (targetAlias) {
                  void handleFallbackProjectSelect(targetAlias, msg.id, card.userDeliverable);
                }
              }}
            >
              <option value="">Select from registered projects...</option>
              {projects.map((p) => (
                <option key={p.alias} value={p.alias}>
                  {p.alias}
                </option>
              ))}
            </select>
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
          <div className="card-fallback-row">
            <select
              aria-label="Select registered project"
              className="card-fallback-select"
              defaultValue=""
              onChange={(e) => {
                const targetAlias = e.target.value;
                if (targetAlias) {
                  void handleFallbackProjectSelect(targetAlias, msg.id, card.userDeliverable);
                }
              }}
            >
              <option value="">Select from registered projects...</option>
              {projects.map((p) => (
                <option key={p.alias} value={p.alias}>
                  {p.alias}
                </option>
              ))}
            </select>
          </div>
        </div>
      );
    }

    if (card.type === "prompt-project") {
      return (
        <div className="inference-card" aria-label="Project selection prompt">
          <header>Project selection <span>Action needed</span></header>
          <p>{card.prompt}</p>
          <div className="card-fallback-row">
            <select
              aria-label="Select registered project"
              className="card-fallback-select"
              defaultValue=""
              onChange={(e) => {
                const targetAlias = e.target.value;
                if (targetAlias) {
                  void handleFallbackProjectSelect(targetAlias, msg.id, card.userDeliverable);
                }
              }}
            >
              <option value="">Select from registered projects...</option>
              {projects.map((p) => (
                <option key={p.alias} value={p.alias}>
                  {p.alias}
                </option>
              ))}
            </select>
          </div>
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
          onLaunchTerminal={openLaunchModal}
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
        <button className="new-thread" onClick={() => void handleNewThread()} type="button">
          + New orchestration thread
        </button>
        <nav className="history" aria-label="Recent threads">
          <h2>Recent</h2>
          {threads.map((t) => {
            const isRenaming = renamingThreadId === t.id;
            const threadTitle = t.title || "Continuation workspace";
            return (
              <div key={t.id} className={`thread-item-wrap ${t.id === activeThreadId ? "active" : ""}`}>
                {isRenaming ? (
                  <form
                    className="thread-rename-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleSaveThreadRename(t.id, renameThreadValue);
                    }}
                  >
                    <input
                      aria-label="Rename thread"
                      autoFocus
                      className="thread-rename-input"
                      onChange={(e) => setRenameThreadValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setRenamingThreadId(null);
                        }
                      }}
                      type="text"
                      value={renameThreadValue}
                    />
                    <div className="thread-rename-actions">
                      <button className="button primary compact" type="submit">
                        Save
                      </button>
                      <button
                        className="button secondary compact"
                        onClick={() => setRenamingThreadId(null)}
                        type="button"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div
                      className={`thread ${t.id === activeThreadId ? "active" : ""}`}
                      onClick={() => void handleSelectThread(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          void handleSelectThread(t.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="thread-title">{threadTitle}</div>
                      <small>
                        Scope: {t.projectAlias ?? (t.id === activeThreadId ? (effectiveProject?.alias ?? "not attached") : "not attached")}
                      </small>
                    </div>
                    <div className="thread-actions" aria-label="Thread actions">
                      <button
                        aria-label={`Rename thread ${threadTitle}`}
                        className="thread-action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingThreadId(t.id);
                          setRenameThreadValue(threadTitle);
                        }}
                        title="Rename thread"
                        type="button"
                      >
                        ✏️
                      </button>
                      <button
                        aria-label={`Delete thread ${threadTitle}`}
                        className="thread-action-btn delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteThread(t.id, threadTitle);
                        }}
                        title="Delete thread"
                        type="button"
                      >
                        🗑️
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </nav>
      </aside>

      <section className="chat-column" aria-label="Assistant orchestration thread">
        <header className="chat-header">
          <div>
            <h1>{activeThreadTitle || "Continuation workspace"}</h1>
            <p>Persistent orchestration thread; every terminal action declares its project scope.</p>
          </div>
          <button
            className="button secondary export-btn"
            onClick={handleExportConversation}
            type="button"
          >
            Export conversation (.md)
          </button>
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
              <div className="compose-project-picker">
                <label htmlFor="composer-project-select" className="composer-project-label">Scope:</label>
                <select
                  id="composer-project-select"
                  className="composer-project-select"
                  aria-label="Select target workspace"
                  value={effectiveProject?.alias ?? ""}
                  onChange={(e) => handleComposerProjectChange(e.target.value)}
                >
                  <option value="">Select workspace...</option>
                  {projects.map((p) => (
                    <option key={p.alias} value={p.alias}>{p.alias}</option>
                  ))}
                </select>
              </div>
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
            {(catalogExpanded || projects.length <= 5 ? projects : projects.slice(0, 5)).map((project) => {
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

          {projects.length > 5 && (
            <div className="catalog-toggle-bar">
              <button
                className="button ghost compact catalog-toggle-button"
                onClick={() => setCatalogExpanded((prev) => !prev)}
                type="button"
              >
                {catalogExpanded ? "Show fewer" : `Show all (${projects.length}) projects`}
              </button>
            </div>
          )}

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
          <label className="field-label" htmlFor="transcript">Codex transcript fallback (optional)</label>
          <textarea
            id="transcript"
            className="transcript-textarea"
            onChange={(event) => setTranscript(event.target.value)}
            placeholder="Used only when no handoff or state document is supplied"
            value={transcript}
          />
        </Panel>

        <Panel title="Work surface" detail="The terminal is a project surface, never a second assistant.">
          <div className="terminal-state"><strong>Embedded terminal - v0.1</strong><span>{terminalId ? "Live terminal attached" : "Launch after brief approval"}</span></div>
          <p className="future-note">vNext: a user-triggered pop-out browser window authenticated to this same PTY.</p>
          <p className="control-message" role="status"><span className="pulse" />{message}</p>
        </Panel>
      </aside>
    </main>

    {isLaunchModalOpen && effectiveProject && (
      <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="codex-modal-title">
        <div className="modal-card">
          <header className="modal-header">
            <h2 id="codex-modal-title">Launch Codex Terminal</h2>
            <p className="modal-target-info">
              Target workspace: <strong>{effectiveProject.alias}</strong> <span className="modal-path">({effectiveProject.root})</span>
            </p>
          </header>

          <div className="modal-body">
            <fieldset className="modal-field">
              <legend className="modal-legend">Session Mode</legend>
              <div className="modal-radio-group">
                <label className={`modal-radio-option ${launchMode === "resume" ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="launch-mode"
                    value="resume"
                    checked={launchMode === "resume"}
                    onChange={() => setLaunchMode("resume")}
                  />
                  <div className="modal-radio-label">
                    <strong>Resume existing session</strong>
                    <small>Opens native Codex session picker in terminal; press Esc to exit/start new</small>
                  </div>
                </label>
                <label className={`modal-radio-option ${launchMode === "new" ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="launch-mode"
                    value="new"
                    checked={launchMode === "new"}
                    onChange={() => setLaunchMode("new")}
                  />
                  <div className="modal-radio-label">
                    <strong>Start new session</strong>
                    <small>Starts a fresh Codex session in project root</small>
                  </div>
                </label>
              </div>
            </fieldset>

            <fieldset className="modal-field">
              <legend className="modal-legend">Shell environment</legend>
              <div className="modal-radio-group">
                <label className={`modal-radio-option ${launchShell === "bash" ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="launch-shell"
                    value="bash"
                    checked={launchShell === "bash"}
                    onChange={() => setLaunchShell("bash")}
                  />
                  <div className="modal-radio-label">
                    <strong>Git Bash (recommended)</strong>
                    <small>Runs inside Git Bash with POSIX commands (ls, git, grep); drops into an interactive bash prompt if Codex exits</small>
                  </div>
                </label>
                <label className={`modal-radio-option ${launchShell === "native" ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="launch-shell"
                    value="native"
                    checked={launchShell === "native"}
                    onChange={() => setLaunchShell("native")}
                  />
                  <div className="modal-radio-label">
                    <strong>Native Windows</strong>
                    <small>Direct codex.exe execution in Windows ConPTY</small>
                  </div>
                </label>
              </div>
            </fieldset>

            <div className="modal-field">
              <label htmlFor="launch-model-input">Model</label>
              <input
                id="launch-model-input"
                className="input modal-input"
                type="text"
                value={launchModel}
                onChange={(e) => setLaunchModel(e.target.value)}
                placeholder="gpt-5.6-terra"
              />
            </div>

            <div className="modal-field">
              <label htmlFor="launch-reasoning-select">Reasoning effort</label>
              <select
                id="launch-reasoning-select"
                className="input modal-select"
                value={launchReasoning}
                onChange={(e) => setLaunchReasoning(e.target.value as "low" | "medium" | "high")}
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>
          </div>

          <footer className="modal-actions">
            <button
              className="button ghost"
              type="button"
              onClick={() => setIsLaunchModalOpen(false)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              type="button"
              onClick={() => void handleConfirmLaunch()}
            >
              Launch terminal
            </button>
          </footer>
        </div>
      </div>
    )}
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
