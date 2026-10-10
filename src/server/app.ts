import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { join } from "node:path";
import { z } from "zod";

import { assembleEvidence, formatEvidenceForBrief } from "./evidence/assemble-evidence.js";
import { ProjectRegistry } from "./projects/project-registry.js";
import { ProviderRegistry } from "./providers/provider-registry.js";
import { verifyLaunchToken } from "./security/launch-token.js";
import { selectRequestToken } from "./security/request-token.js";
import { createTerminalSessionCookie, readTerminalSessionToken } from "./security/terminal-session.js";
import { SessionManager } from "./sessions/session-manager.js";
import { pickFolder, type FolderPickerRunner } from "./system/folder-picker.js";
import { TerminalService } from "./terminals/terminal-service.js";


const tokenHeader = "x-agent-runner-token";


type ApplicationDependencies = {
  launchToken: string;
  providers: ProviderRegistry;
  projects: ProjectRegistry;
  sessions: SessionManager;
  terminals: TerminalService;
  pickFolder?: FolderPickerRunner;
};


const projectSchema = z.object({ alias: z.string().min(1), root: z.string().min(1) });
const terminalSchema = z.object({ project_alias: z.string().min(1) });
const briefSchema = z.object({
  provider_id: z.string().min(1),
  model: z.string().min(1),
  deliverable: z.string().min(1),
  handoff: z.string().optional(),
  state_documents: z.array(z.object({ path: z.string().min(1), content: z.string().min(1) })),
  transcript: z.string().optional(),
  git_status: z.string().optional(),
});


export async function createApplication(dependencies: ApplicationDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(websocket);
  await app.register(fastifyStatic, { root: join(process.cwd(), "dist") });

  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
      const text = typeof body === "string" ? body.trim() : "";
      if (!text) {
        done(null, undefined);
        return;
      }

      try {
        done(null, JSON.parse(text));
      } catch {
        const error = Object.assign(new Error("Invalid JSON"), { statusCode: 400 });
        done(error, undefined);
      }
    },
  );

  app.addHook("preHandler", async (request, reply) => {
    if (!isApiRequest(request) || isWebSocketUpgrade(request)) {
      return;
    }

    if (isAuthorized(request, dependencies.launchToken)) {
      return;
    }

    await reply.code(401).send({ error: "invalid_launch_token" });
  });

  const folderPicker = dependencies.pickFolder ?? pickFolder;

  app.get("/api/v1/health", async () => ({ status: "ok" }));

  app.post("/api/v1/system/browse-folder", async () => folderPicker());

  app.get("/api/v1/providers", async () => ({ providers: dependencies.providers.list() }));

  app.post("/api/v1/providers/refresh", async () => ({ providers: await dependencies.providers.refreshHealth() }));

  app.get("/api/v1/providers/:providerId/models", async (request) => {
    const params = z.object({ providerId: z.string().min(1) }).parse(request.params);
    return { models: await dependencies.providers.listModels(params.providerId) };
  });

  app.get("/api/v1/projects", async () => ({ projects: dependencies.projects.list() }));

  app.post("/api/v1/projects", async (request, reply) => {
    const input = projectSchema.parse(request.body);
    const project = await dependencies.projects.add(input.alias, input.root);
    await reply.code(201).send({ project });
  });

  app.post("/api/v1/briefs", async (request, reply) => {
    const input = briefSchema.parse(request.body);
    const evidence = assembleEvidence({
      deliverable: input.deliverable,
      handoff: input.handoff,
      stateDocuments: input.state_documents,
      transcript: input.transcript,
      gitStatus: input.git_status,
    });
    const content = await dependencies.providers.createBrief(input.provider_id, {
      model: input.model,
      evidence: formatEvidenceForBrief(evidence),
    });

    await reply.code(201).send({
      provider_id: input.provider_id,
      model: input.model,
      evidence,
      content,
    });
  });

  app.post("/api/v1/terminals", async (request, reply) => {
    const input = terminalSchema.parse(request.body);
    const project = dependencies.projects.require(input.project_alias);
    const reservation = dependencies.sessions.reserve(project.root);
    if (!reservation.accepted) {
      await reply.code(409).send({ error: reservation.reason });
      return;
    }

    try {
      dependencies.terminals.start(reservation.id, project.root);
      reply.header("set-cookie", createTerminalSessionCookie(dependencies.launchToken));
      await reply.code(201).send({ terminal_id: reservation.id, project });
    } catch (error) {
      dependencies.sessions.release(reservation.id);
      throw error;
    }
  });

  app.get("/api/v1/terminals", async () => ({ terminals: dependencies.sessions.list() }));

  app.get("/api/v1/terminals/:terminalId", { websocket: true }, (socket, request) => {
    const token = readTerminalSessionToken(request.headers.cookie);
    if (!verifyLaunchToken(dependencies.launchToken, token)) {
      socket.close(1008, "invalid launch token");
      return;
    }

    const terminalId = z.object({ terminalId: z.string().min(1) }).parse(request.params).terminalId;
    const unsubscribe = dependencies.terminals.subscribe(
      terminalId,
      (data) => socket.send(JSON.stringify({ type: "output", data })),
      (exitCode, signal) => socket.send(JSON.stringify({ type: "exit", exit_code: exitCode, signal })),
    );
    socket.on("message", (rawMessage: Buffer) => {
      const message = z.discriminatedUnion("type", [
        z.object({ type: z.literal("input"), data: z.string() }),
        z.object({ type: z.literal("resize"), cols: z.number().int().positive(), rows: z.number().int().positive() }),
        z.object({ type: z.literal("stop") }),
      ]).parse(JSON.parse(rawMessage.toString()));
      if (message.type === "input") {
        dependencies.terminals.write(terminalId, message.data);
      } else if (message.type === "resize") {
        dependencies.terminals.resize(terminalId, message.cols, message.rows);
      } else {
        dependencies.terminals.stop(terminalId);
      }
    });
    socket.on("close", unsubscribe);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      void reply.code(422).send({ error: "validation_error", issues: error.issues });
      return;
    }

    const errorMessage = error instanceof Error ? error.message : "Unexpected server error.";
    const isKnownClientError = errorMessage.startsWith("Unknown project alias") || errorMessage.includes("not healthy");
    const statusCode = isKnownClientError ? 409 : 500;
    void reply.code(statusCode).send({ error: errorMessage });
  });

  return app;
}


function isAuthorized(request: FastifyRequest, launchToken: string): boolean {
  const header = request.headers[tokenHeader];
  const headerToken = Array.isArray(header) ? header[0] : header;
  const token = selectRequestToken({ headerToken, queryToken: undefined, websocketUpgrade: false });
  return verifyLaunchToken(launchToken, token);
}


function isApiRequest(request: FastifyRequest): boolean {
  return request.url.startsWith("/api/v1/");
}


function isWebSocketUpgrade(request: FastifyRequest): boolean {
  return request.headers.upgrade?.toLowerCase() === "websocket";
}
