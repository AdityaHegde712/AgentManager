import { fileURLToPath } from "node:url";

import { loadLocalEnvironment } from "../server/config/environment.js";


loadLocalEnvironment();


export type CliOptions = {
  baseUrl?: string;
  token?: string;
  fetchFn?: typeof fetch;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
};


export async function runCli(args: string[], options: CliOptions = {}): Promise<number> {
  const stdout = options.stdout ?? ((msg: string) => console.log(msg));
  const stderr = options.stderr ?? ((msg: string) => console.error(msg));
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  // Parse global flags
  let host = "127.0.0.1";
  let port = process.env.AGENT_RUNNER_PORT ?? "4310";
  let token = options.token ?? process.env.AGENT_RUNNER_TOKEN ?? "";
  let baseUrl = options.baseUrl ?? "";
  let aliasFlag = "";
  let deliverableFlag = "";
  let modelFlag = "";

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--token" && i + 1 < args.length) {
      token = args[++i];
    } else if (arg === "--port" && i + 1 < args.length) {
      port = args[++i];
    } else if (arg === "--host" && i + 1 < args.length) {
      host = args[++i];
    } else if (arg === "--url" && i + 1 < args.length) {
      baseUrl = args[++i];
    } else if (arg === "--alias" && i + 1 < args.length) {
      aliasFlag = args[++i];
    } else if (arg === "--deliverable" && i + 1 < args.length) {
      deliverableFlag = args[++i];
    } else if (arg === "--model" && i + 1 < args.length) {
      modelFlag = args[++i];
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }

  if (!baseUrl) {
    baseUrl = `http://${host}:${port}`;
  }

  const command = positional[0]?.toLowerCase() ?? "help";

  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string>),
    };
    if (token) {
      headers["x-agent-runner-token"] = token;
    }
    if (init.body && !headers["content-type"]) {
      headers["content-type"] = "application/json";
    }

    try {
      return await fetchFn(`${baseUrl}${path}`, {
        ...init,
        headers,
      });
    } catch (err) {
      throw new Error(`Failed to connect to AgentRunner at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  try {
    switch (command) {
      case "status":
      case "health": {
        const healthRes = await request("/api/v1/health");
        if (!healthRes.ok) {
          stderr(`Health check failed with HTTP ${healthRes.status}.`);
          return 1;
        }

        const providersRes = await request("/api/v1/providers");
        if (!providersRes.ok) {
          stderr(`Providers check failed with HTTP ${providersRes.status}. (Token may be missing or invalid)`);
          return 1;
        }

        const providersData = (await providersRes.json()) as {
          providers: Array<{ id: string; label: string; status: string; detail?: string }>;
        };

        stdout(`Server Status: healthy (${baseUrl})`);
        stdout(`Providers (${providersData.providers.length}):`);
        for (const p of providersData.providers) {
          const detail = p.detail ? ` (${p.detail})` : "";
          stdout(`  - ${p.label} [${p.id}]: ${p.status}${detail}`);
        }
        return 0;
      }

      case "projects": {
        const res = await request("/api/v1/projects");
        if (!res.ok) {
          stderr(`Projects request failed with HTTP ${res.status}.`);
          return 1;
        }

        const data = (await res.json()) as { projects: Array<{ alias: string; root: string }> };
        stdout(`Registered Projects (${data.projects.length}):`);
        if (data.projects.length === 0) {
          stdout("  (No projects registered yet)");
        } else {
          for (const proj of data.projects) {
            stdout(`  - ${proj.alias} -> ${proj.root}`);
          }
        }
        return 0;
      }

      case "register": {
        const alias = positional[1] ?? aliasFlag;
        const projectPath = positional[2];

        if (!alias || !projectPath) {
          stderr("Usage: register <alias> <path> (or --alias <alias>)");
          return 1;
        }

        const res = await request("/api/v1/projects", {
          method: "POST",
          body: JSON.stringify({ alias, root: projectPath }),
        });

        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as { error?: string };
          stderr(`Registration failed (HTTP ${res.status}): ${errData.error ?? res.statusText}`);
          return 1;
        }

        const data = (await res.json()) as { project: { alias: string; root: string } };
        stdout(`Successfully registered project '${data.project.alias}':`);
        stdout(`  Root: ${data.project.root}`);
        return 0;
      }

      case "brief": {
        const alias = aliasFlag || positional[1];
        const deliverable = deliverableFlag || positional.slice(2).join(" ");

        if (!deliverable) {
          stderr("Usage: brief --deliverable \"<deliverable>\" [--alias <alias>] [--model <model>]");
          return 1;
        }

        // Fetch providers to find active healthy provider and model
        const providersRes = await request("/api/v1/providers");
        if (!providersRes.ok) {
          stderr(`Failed to fetch providers (HTTP ${providersRes.status}).`);
          return 1;
        }

        const { providers } = (await providersRes.json()) as {
          providers: Array<{ id: string; status: string }>;
        };
        const healthyProvider = providers.find((p) => p.status === "healthy");
        if (!healthyProvider) {
          stderr("No healthy LLM provider available to draft brief.");
          return 1;
        }

        let selectedModel = modelFlag;
        if (!selectedModel) {
          const modelsRes = await request(`/api/v1/providers/${healthyProvider.id}/models`);
          if (modelsRes.ok) {
            const { models } = (await modelsRes.json()) as { models: Array<{ id: string }> };
            selectedModel = models[0]?.id ?? "openrouter/free";
          } else {
            selectedModel = "openrouter/free";
          }
        }

        stdout(`Drafting continuation brief${alias ? ` for '${alias}'` : ""} using ${healthyProvider.id} (${selectedModel})...`);
        const briefRes = await request("/api/v1/briefs", {
          method: "POST",
          body: JSON.stringify({
            provider_id: healthyProvider.id,
            model: selectedModel,
            deliverable,
            state_documents: [],
          }),
        });

        if (!briefRes.ok) {
          const errData = (await briefRes.json().catch(() => ({}))) as { error?: string };
          stderr(`Brief generation failed (HTTP ${briefRes.status}): ${errData.error ?? briefRes.statusText}`);
          return 1;
        }

        const briefData = (await briefRes.json()) as { content: string };
        stdout("----------------------------------------");
        stdout(briefData.content);
        stdout("----------------------------------------");
        return 0;
      }

      case "terminals": {
        const res = await request("/api/v1/terminals");
        if (!res.ok) {
          stderr(`Terminals request failed with HTTP ${res.status}.`);
          return 1;
        }

        const data = (await res.json()) as {
          terminals: Array<{ terminal_id: string; root: string }>;
        };
        stdout(`Active Terminals (${data.terminals.length}):`);
        if (data.terminals.length === 0) {
          stdout("  (No active terminal sessions)");
        } else {
          for (const t of data.terminals) {
            stdout(`  - ${t.terminal_id} (root: ${t.root})`);
          }
        }
        return 0;
      }

      case "help":
      default: {
        stdout("AgentRunner CLI Debug Utility");
        stdout("Usage: npm run cli -- <command> [options]");
        stdout("");
        stdout("Commands:");
        stdout("  status / health               Check server and provider health");
        stdout("  projects                      List registered project workspaces");
        stdout("  register <alias> <path>       Register a project workspace");
        stdout("  brief --deliverable <text>    Draft a continuation brief");
        stdout("  terminals                     List active terminal sessions");
        stdout("");
        stdout("Global Options:");
        stdout("  --token <token>               Launch authorization token");
        stdout("  --url <url>                   Base URL (default: http://127.0.0.1:4310)");
        stdout("  --port <port>                 Server port (default: 4310)");
        return 0;
      }
    }
  } catch (err) {
    stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }
}


const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].replace(/\\/g, "/").endsWith("src/cli/main.ts") ||
    process.argv[1].replace(/\\/g, "/").endsWith("src/cli/main.js"));

if (isDirectRun) {
  runCli(process.argv.slice(2)).then((code) => {
    if (code !== 0) {
      process.exitCode = code;
    }
  });
}
