import type { AssistantLlmProvider, ProviderModel, ProviderSnapshot } from "./types.js";


export class ProviderRegistry {
  private readonly providers = new Map<string, AssistantLlmProvider>();
  private readonly snapshots = new Map<string, ProviderSnapshot>();


  public constructor(providers: AssistantLlmProvider[]) {
    for (const provider of providers) {
      if (this.providers.has(provider.id)) {
        throw new Error(`Duplicate provider id: ${provider.id}`);
      }

      this.providers.set(provider.id, provider);
      this.snapshots.set(provider.id, {
        id: provider.id,
        label: provider.label,
        status: "checking",
      });
    }
  }


  public async refreshHealth(): Promise<ProviderSnapshot[]> {
    const snapshots = await Promise.all(
      [...this.providers.values()].map(async (provider) => {
        const snapshot = await provider.healthCheck();
        this.snapshots.set(provider.id, snapshot);
        return snapshot;
      }),
    );

    return snapshots;
  }


  public list(): ProviderSnapshot[] {
    return [...this.providers.keys()].map((id) => this.requireSnapshot(id));
  }


  public async listModels(providerId: string): Promise<ProviderModel[]> {
    const snapshot = this.requireSnapshot(providerId);
    if (snapshot.status !== "healthy") {
      throw new Error(`Provider ${providerId} is not healthy.`);
    }

    return this.requireProvider(providerId).listModels();
  }


  public async createBrief(providerId: string, request: { model: string; evidence: string }): Promise<string> {
    const snapshot = this.requireSnapshot(providerId);
    if (snapshot.status !== "healthy") {
      throw new Error(`Provider ${providerId} is not healthy.`);
    }

    return this.requireProvider(providerId).createBrief(request);
  }


  private requireProvider(providerId: string): AssistantLlmProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    return provider;
  }


  private requireSnapshot(providerId: string): ProviderSnapshot {
    const snapshot = this.snapshots.get(providerId);
    if (!snapshot) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    return snapshot;
  }
}
