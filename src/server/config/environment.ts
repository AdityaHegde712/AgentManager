import { config, type DotenvConfigOptions } from "dotenv";


export const localEnvironmentOptions: DotenvConfigOptions = {
  path: ".env",
  override: false,
  quiet: true,
};


export function loadLocalEnvironment(): void {
  config(localEnvironmentOptions);
}
