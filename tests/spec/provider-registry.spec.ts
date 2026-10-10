import { describe, expect, it } from "vitest";

import { createOpenRouterProvider } from "../../src/server/providers/openrouter-provider.js";
import { ProviderRegistry } from "../../src/server/providers/provider-registry.js";


describe("provider registry", () => {
  it("reports an unconfigured provider without calling the network", async () => {
    const fetchMock = async (): Promise<Response> => {
      throw new Error("network must not be called");
    };
    const registry = new ProviderRegistry([
      createOpenRouterProvider({ apiKey: undefined, fetch: fetchMock }),
    ]);

    await registry.refreshHealth();

    expect(registry.list()).toEqual([
      expect.objectContaining({ id: "openrouter", status: "unconfigured" }),
    ]);
  });

  it("exposes only zero-cost OpenRouter models after a healthy check", async () => {
    const fetchMock = async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          data: [
            { id: "vendor/free-model:free", pricing: { prompt: "0", completion: "0" } },
            { id: "vendor/paid-model", pricing: { prompt: "0.001", completion: "0.001" } },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const registry = new ProviderRegistry([
      createOpenRouterProvider({ apiKey: "test-key", fetch: fetchMock }),
    ]);

    await registry.refreshHealth();

    expect(registry.list()).toEqual([
      expect.objectContaining({ id: "openrouter", status: "healthy" }),
    ]);
    await expect(registry.listModels("openrouter")).resolves.toEqual([
      { id: "vendor/free-model:free", label: "vendor/free-model:free" },
    ]);
  });
});
