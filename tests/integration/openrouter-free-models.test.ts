import { describe, expect, it } from "vitest";

import { createOpenRouterProvider } from "../../src/server/providers/openrouter-provider.js";


describe("openrouter free models and error reporting", () => {
  it("includes openrouter/free router at the top, includes :free suffix models, and excludes paid models", async () => {
    const fetchMock = async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          data: [
            { id: "meta-llama/llama-3-8b-instruct:free", pricing: { prompt: "0", completion: "0" } },
            { id: "google/gemma-2-9b-it:free" },
            { id: "custom/zero-cost-model", pricing: { prompt: "0", completion: "0" } },
            { id: "openai/gpt-4o", pricing: { prompt: "0.005", completion: "0.015" } },
            { id: "anthropic/claude-3-opus" },
            { id: "paid/model:standard", pricing: { prompt: "0.001", completion: "0" } },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchMock,
      autoRouter: true,
    });

    const models = await provider.listModels();

    // openrouter/free is included at the top of the returned model list
    expect(models[0]).toEqual({
      id: "openrouter/free",
      label: "OpenRouter Free Router (openrouter/free)",
    });

    // Models with :free suffix are included
    expect(models).toContainEqual({
      id: "meta-llama/llama-3-8b-instruct:free",
      label: "meta-llama/llama-3-8b-instruct:free",
    });
    expect(models).toContainEqual({
      id: "google/gemma-2-9b-it:free",
      label: "google/gemma-2-9b-it:free",
    });

    // Pricing zero without suffix is also included
    expect(models).toContainEqual({
      id: "custom/zero-cost-model",
      label: "custom/zero-cost-model",
    });

    // Paid models are excluded
    const modelIds = models.map((model) => model.id);
    expect(modelIds).not.toContain("openai/gpt-4o");
    expect(modelIds).not.toContain("anthropic/claude-3-opus");
    expect(modelIds).not.toContain("paid/model:standard");
  });

  it("reports descriptive error detail when health check fails", async () => {
    const fetchMock = async (): Promise<Response> =>
      new Response(
        JSON.stringify({ error: { message: "Invalid API key provided" } }),
        { status: 401, headers: { "content-type": "application/json" } },
      );

    const provider = createOpenRouterProvider({
      apiKey: "invalid-key",
      fetch: fetchMock,
    });

    const snapshot = await provider.healthCheck();
    expect(snapshot.status).toBe("degraded");
    expect(snapshot.detail).toContain("401");
    expect(snapshot.detail).toContain("Invalid API key provided");
  });

  it("handles errors gracefully and throws meaningful errors when listModels request fails", async () => {
    const fetchMock = async (): Promise<Response> =>
      new Response(
        JSON.stringify({ error: { message: "Rate limit exceeded" } }),
        { status: 429, headers: { "content-type": "application/json" } },
      );

    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchMock,
    });

    await expect(provider.listModels()).rejects.toThrow(/OpenRouter listModels failed.*429.*Rate limit exceeded/);
  });

  it("throws meaningful error when listModels is called on unconfigured provider", async () => {
    const provider = createOpenRouterProvider({
      apiKey: undefined,
    });

    await expect(provider.listModels()).rejects.toThrow("OpenRouter is not configured.");
  });
});
