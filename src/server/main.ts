import { createApplication } from "./app.js";
import { loadLocalEnvironment } from "./config/environment.js";
import { ProjectRegistry } from "./projects/project-registry.js";
import { createOpenRouterProvider } from "./providers/openrouter-provider.js";
import { ProviderRegistry } from "./providers/provider-registry.js";
import { createLaunchToken } from "./security/launch-token.js";
import { createLaunchUrl } from "./security/launch-url.js";
import { SessionManager } from "./sessions/session-manager.js";
import { TerminalService } from "./terminals/terminal-service.js";


loadLocalEnvironment();

const host = "127.0.0.1";
const port = Number.parseInt(process.env.AGENT_RUNNER_PORT ?? "4310", 10);
const launchToken = createLaunchToken();
const sessions = new SessionManager(2);
const terminals = new TerminalService(process.env.AGENT_RUNNER_CODEX_COMMAND ?? "codex", (terminalId) => {
  sessions.release(terminalId);
});
const providers = new ProviderRegistry([
  createOpenRouterProvider({
    apiKey: process.env.OPENROUTER_API_KEY,
    autoRouter: true,
  }),
]);
const app = await createApplication({
  launchToken,
  providers,
  projects: new ProjectRegistry(),
  sessions,
  terminals,
});

await providers.refreshHealth();
await app.listen({ host, port });
console.log(`OPEN THIS URL: ${createLaunchUrl(host, port, launchToken)}`);
