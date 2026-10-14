import type { AssistantLlmProvider, BriefRequest, ProviderModel, ProviderSnapshot } from "./types.js";


type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;


type OpenRouterModel = {
  id: string;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
};


type OpenRouterModelResponse = {
  data?: OpenRouterModel[];
};


type OpenRouterCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};


export type OpenRouterProviderOptions = {
  apiKey: string | undefined;
  fetch?: FetchLike;
  baseUrl?: string;
  autoRouter?: boolean;
  includeAutoRouter?: boolean;
  includeFreeRouter?: boolean;
};


export function createOpenRouterProvider(options: OpenRouterProviderOptions): AssistantLlmProvider {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "https://openrouter.ai/api/v1";

  async function fetchModels(): Promise<OpenRouterModel[]> {
    if (!options.apiKey) {
      return [];
    }

    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${options.apiKey}` },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`OpenRouter models network request failed: ${msg}`);
    }

    if (!response.ok) {
      let bodyDetail = "";
      try {
        const errorJson = (await response.json()) as { error?: { message?: string } };
        bodyDetail = errorJson?.error?.message ?? JSON.stringify(errorJson);
      } catch {
        try {
          bodyDetail = await response.text();
        } catch {
          // ignore
        }
      }
      const message = bodyDetail
        ? `OpenRouter models request failed with status ${response.status}: ${bodyDetail}`
        : `OpenRouter models request failed with status ${response.status}.`;
      throw new Error(message);
    }

    let payload: OpenRouterModelResponse;
    try {
      payload = (await response.json()) as OpenRouterModelResponse;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse OpenRouter models response: ${msg}`);
    }

    return payload.data ?? [];
  }

  return {
    id: "openrouter",
    label: "OpenRouter",

    async healthCheck(): Promise<ProviderSnapshot> {
      if (!options.apiKey) {
        return { id: "openrouter", label: "OpenRouter", status: "unconfigured" };
      }

      try {
        await fetchModels();
        return { id: "openrouter", label: "OpenRouter", status: "healthy" };
      } catch (error) {
        const detail = error instanceof Error ? error.message : "OpenRouter health check failed.";
        return { id: "openrouter", label: "OpenRouter", status: "degraded", detail };
      }
    },

    async listModels(): Promise<ProviderModel[]> {
      if (!options.apiKey) {
        throw new Error("OpenRouter is not configured.");
      }

      let models: OpenRouterModel[];
      try {
        models = await fetchModels();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to fetch OpenRouter models.";
        throw new Error(`OpenRouter listModels failed: ${message}`);
      }

      const freeModels = models
        .filter(
          (model) =>
            model.id !== "openrouter/free" &&
            (model.id.endsWith(":free") || (model.pricing?.prompt === "0" && model.pricing.completion === "0")),
        )
        .map((model) => ({ id: model.id, label: model.id }))
        .sort((left, right) => left.label.localeCompare(right.label));

      const isAutoRouterConfigured = Boolean(
        options.autoRouter ?? options.includeAutoRouter ?? options.includeFreeRouter,
      );

      if (isAutoRouterConfigured) {
        return [
          { id: "openrouter/free", label: "OpenRouter Free Router (openrouter/free)" },
          ...freeModels,
        ];
      }

      return freeModels;
    },

    async createBrief(request: BriefRequest): Promise<string> {
      if (!options.apiKey) {
        throw new Error("OpenRouter is not configured.");
      }

      const SYSTEM_PROMPT =
        "You are a text-only continuation brief writer for an autonomous coding agent.\n" +
        "You have NO tools, NO bash or shell access, and NO ability to execute commands or inspect directories.\n" +
        "NEVER emit tool calls, function calls, bash commands, or XML invocation tags (such as <dots_function_call>, <invoke>, <function_calls>, <tool_call>).\n" +
        "Your ONLY task is to synthesize the provided deliverable and evidence into a structured, reviewable Markdown continuation brief for the next developer agent.\n\n" +
        "Format your response strictly using these Markdown sections:\n" +
        "# Continuation Brief\n" +
        "## 1. Objective & Requested Deliverable\n" +
        "## 2. Evidence & Context Summary\n" +
        "## 3. Constraints & Operational Directives\n" +
        "## 4. Immediate Concrete Next Action\n\n" +
        "Do not claim unverified work is complete. Output only the pure markdown brief text.";

      let response: Response;
      try {
        response = await fetchFn(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: request.model,
            stream: false,
            messages: [
              {
                role: "system",
                content: SYSTEM_PROMPT,
              },
              { role: "user", content: request.evidence },
            ],
          }),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`OpenRouter completion network request failed: ${msg}`);
      }

      if (!response.ok) {
        let bodyDetail = "";
        try {
          const errorJson = (await response.json()) as { error?: { message?: string } };
          bodyDetail = errorJson?.error?.message ?? JSON.stringify(errorJson);
        } catch {
          try {
            bodyDetail = await response.text();
          } catch {
            // ignore
          }
        }
        const message = bodyDetail
          ? `OpenRouter completion request failed with status ${response.status}: ${bodyDetail}`
          : `OpenRouter completion request failed with status ${response.status}.`;
        throw new Error(message);
      }

      let payload: OpenRouterCompletionResponse;
      try {
        payload = (await response.json()) as OpenRouterCompletionResponse;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to parse OpenRouter completion response: ${msg}`);
      }

      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error("OpenRouter returned no brief content.");
      }

      const cleanContent = content
        .replace(/<dots_function_call>[\s\S]*?<\/dots_function_call>/gi, "")
        .replace(/<invoke[\s\S]*?<\/invoke>/gi, "")
        .replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, "")
        .trim();

      if (!cleanContent) {
        throw new Error("OpenRouter returned a tool-call instead of brief markdown content.");
      }

      return cleanContent;
    },
  };
}
