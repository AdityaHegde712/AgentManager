export type ProviderStatus = "unconfigured" | "checking" | "healthy" | "degraded" | "unavailable";


export type ProviderModel = {
  id: string;
  label: string;
};


export type ProviderSnapshot = {
  id: string;
  label: string;
  status: ProviderStatus;
  detail?: string;
};


export type BriefRequest = {
  model: string;
  evidence: string;
};


export type AssistantLlmProvider = {
  readonly id: string;
  readonly label: string;
  healthCheck(): Promise<ProviderSnapshot>;
  listModels(): Promise<ProviderModel[]>;
  createBrief(request: BriefRequest): Promise<string>;
};
