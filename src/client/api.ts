export type ProviderStatus = "unconfigured" | "checking" | "healthy" | "degraded" | "unavailable";


export type ProviderSnapshot = {
  id: string;
  label: string;
  status: ProviderStatus;
  detail?: string;
};


export type ProjectAlias = {
  alias: string;
  root: string;
};


export type EvidenceItem = {
  kind: string;
  label: string;
  content: string;
};


export type Brief = {
  provider_id: string;
  model: string;
  evidence: EvidenceItem[];
  content: string;
};


export type ThreadSummary = {
  id: string;
  title: string;
  projectAlias?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};


export type ThreadRecord<T = unknown> = {
  id: string;
  title: string;
  projectAlias?: string;
  createdAt: string;
  updatedAt: string;
  messages: T[];
};


export class AgentRunnerApi {
  private readonly token: string;


  public constructor() {
    this.token = consumeLaunchToken(
      window.location,
      window.sessionStorage,
      (url) => window.history.replaceState(null, "", url),
    );
  }


  public async providers(): Promise<ProviderSnapshot[]> {
    const response = await this.request("/api/v1/providers");
    return (await response.json() as { providers: ProviderSnapshot[] }).providers;
  }


  public async refreshProviders(): Promise<ProviderSnapshot[]> {
    const response = await this.request("/api/v1/providers/refresh", { method: "POST" });
    return (await response.json() as { providers: ProviderSnapshot[] }).providers;
  }


  public async models(providerId: string): Promise<Array<{ id: string; label: string }>> {
    const response = await this.request(`/api/v1/providers/${encodeURIComponent(providerId)}/models`);
    return (await response.json() as { models: Array<{ id: string; label: string }> }).models;
  }


  public async projects(): Promise<ProjectAlias[]> {
    const response = await this.request("/api/v1/projects");
    return (await response.json() as { projects: ProjectAlias[] }).projects;
  }


  public async addProject(
    alias: string,
    root: string,
  ): Promise<{ project: ProjectAlias; duplicate_ignored: boolean }> {
    const response = await this.request("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({ alias, root }),
    });
    return (await response.json()) as { project: ProjectAlias; duplicate_ignored: boolean };
  }


  public async scanProjects(
    directory: string,
  ): Promise<{ added: ProjectAlias[]; skipped: string[]; duplicates: string[] }> {
    const response = await this.request("/api/v1/projects/scan", {
      method: "POST",
      body: JSON.stringify({ directory }),
    });
    return (await response.json()) as { added: ProjectAlias[]; skipped: string[]; duplicates: string[] };
  }


  public async deleteProject(alias: string): Promise<void> {
    await this.request(`/api/v1/projects/${encodeURIComponent(alias)}`, {
      method: "DELETE",
    });
  }


  public async renameProject(oldAlias: string, newAlias: string): Promise<ProjectAlias> {
    const response = await this.request(`/api/v1/projects/${encodeURIComponent(oldAlias)}`, {
      method: "PATCH",
      body: JSON.stringify({ alias: newAlias }),
    });
    return (await response.json() as { project: ProjectAlias }).project;
  }


  public async browseFolder(): Promise<{ canceled: boolean; path: string | null }> {
    const response = await this.request("/api/v1/system/browse-folder", {
      method: "POST",
    });
    return (await response.json()) as { canceled: boolean; path: string | null };
  }


  public async createBrief(input: {
    projectAlias?: string;
    providerId: string;
    model: string;
    deliverable: string;
    handoff?: string;
    stateDocuments?: Array<{ path: string; content: string }>;
    transcript?: string;
    gitStatus?: string;
  }): Promise<Brief> {
    const response = await this.request("/api/v1/briefs", {
      method: "POST",
      body: JSON.stringify({
        project_alias: input.projectAlias,
        provider_id: input.providerId,
        model: input.model,
        deliverable: input.deliverable,
        handoff: input.handoff,
        state_documents: input.stateDocuments,
        transcript: input.transcript,
        git_status: input.gitStatus,
      }),
    });
    return await response.json() as Brief;
  }


  public async startTerminal(
    projectAlias: string,
    options?: {
      mode?: "resume" | "new";
      model?: string;
      reasoningEffort?: "low" | "medium" | "high";
    },
  ): Promise<{ terminal_id: string }> {
    const response = await this.request("/api/v1/terminals", {
      method: "POST",
      body: JSON.stringify({
        project_alias: projectAlias,
        mode: options?.mode,
        model: options?.model,
        reasoning_effort: options?.reasoningEffort,
      }),
    });
    return await response.json() as { terminal_id: string };
  }


  public async listThreads(): Promise<ThreadSummary[]> {
    const response = await this.request("/api/v1/threads");
    const data = await response.json() as { threads: ThreadSummary[] } | ThreadSummary[];
    return Array.isArray(data) ? data : data.threads;
  }


  public async getThread<T = unknown>(threadId: string): Promise<ThreadRecord<T>> {
    const response = await this.request(`/api/v1/threads/${encodeURIComponent(threadId)}`);
    const data = await response.json() as { thread: ThreadRecord<T> } | ThreadRecord<T>;
    return "thread" in data ? data.thread : data;
  }


  public async createThread<T = unknown>(input?: {
    title?: string;
    projectAlias?: string;
  }): Promise<ThreadRecord<T>> {
    const response = await this.request("/api/v1/threads", {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    });
    const data = await response.json() as { thread: ThreadRecord<T> } | ThreadRecord<T>;
    return "thread" in data ? data.thread : data;
  }


  public async saveMessages<T = unknown>(threadId: string, messages: T[]): Promise<ThreadRecord<T>> {
    const response = await this.request(`/api/v1/threads/${encodeURIComponent(threadId)}/messages`, {
      method: "PUT",
      body: JSON.stringify({ messages }),
    });
    const data = await response.json() as { thread: ThreadRecord<T> } | ThreadRecord<T>;
    return "thread" in data ? data.thread : data;
  }


  public async updateThread<T = unknown>(
    threadId: string,
    updates: { title?: string; projectAlias?: string | null },
  ): Promise<ThreadRecord<T>> {
    const response = await this.request(`/api/v1/threads/${encodeURIComponent(threadId)}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
    const data = await response.json() as { thread: ThreadRecord<T> } | ThreadRecord<T>;
    return "thread" in data ? data.thread : data;
  }


  public async deleteThread(threadId: string): Promise<void> {
    await this.request(`/api/v1/threads/${encodeURIComponent(threadId)}`, {
      method: "DELETE",
    });
  }


  public terminalUrl(terminalId: string): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/api/v1/terminals/${encodeURIComponent(terminalId)}`;
  }


  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      "x-agent-runner-token": this.token,
    };
    if (init.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    const response = await fetch(path, {
      ...init,
      headers: {
        ...headers,
        ...init.headers,
      },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
      throw new Error(payload.error ?? `Request failed with status ${response.status}.`);
    }

    return response;
  }
}
import { consumeLaunchToken } from "./launch-token.js";
