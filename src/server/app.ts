import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { join } from "node:path";
import { z } from "zod";

import { assembleEvidence, formatEvidenceForBrief } from "./evidence/assemble-evidence.js";
import { autoDiscoverProjectEvidence } from "./evidence/auto-discover.js";
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
const projectScanSchema = z.object({ directory: z.string().min(1) });
const projectAliasParamsSchema = z.object({ alias: z.string().min(1) });
const renameProjectSchema = z.object({ alias: z.string().min(1) });
const terminalSchema = z.object({ project_alias: z.string().min(1) });
const briefSchema = z.object({
  project_alias: z.string().optional(),
  provider_id: z.string().min(1),
  model: z.string().min(1),
  deliverable: z.string().min(1),
  handoff: z.string().optional(),
  state_documents: z.array(z.object({ path: z.string().min(1), content: z.string().min(1) })).optional(),
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
    try {
      const result = await dependencies.projects.add(input.alias, input.root);
      const statusCode = result.duplicate_ignored ? 200 : 201;
      await reply.code(statusCode).send({
        project: result.project,
        duplicate_ignored: result.duplicate_ignored,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Project root does not exist or is not a directory.";
      await reply.code(400).send({ error: message });
    }
  });

  app.post("/api/v1/projects/scan", async (request, reply) => {
    const input = projectScanSchema.parse(request.body);
    try {
      const result = await dependencies.projects.scanDirectory(input.directory);
      await reply.code(200).send({
        added: result.added,
        skipped: result.skipped,
        duplicates: result.duplicates,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Parent directory does not exist or is not a directory.";
      await reply.code(400).send({ error: message });
    }
  });

  app.delete("/api/v1/projects/:alias", async (request, reply) => {
    const params = projectAliasParamsSchema.parse(request.params);
    const deleted = await dependencies.projects.delete(params.alias);
    if (!deleted) {
      await reply.code(404).send({ error: `Unknown project alias: ${params.alias}` });
      return;
    }
    await reply.code(200).send({ success: true, alias: params.alias });
  });

  app.patch("/api/v1/projects/:alias", async (request, reply) => {
    const params = projectAliasParamsSchema.parse(request.params);
    const input = renameProjectSchema.parse(request.body);
    try {
      const project = await dependencies.projects.rename(params.alias, input.alias);
      await reply.code(200).send({ project });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to rename project.";
      const isConflict = message.includes("already exists");
      const isNotFound = message.startsWith("Unknown project alias");
      const statusCode = isConflict ? 409 : isNotFound ? 404 : 400;
      await reply.code(statusCode).send({ error: message });
    }
  });

  app.post("/api/v1/briefs", async (request, reply) => {
    const input = briefSchema.parse(request.body);

    let handoff = input.handoff;
    let gitStatus = input.git_status;
    let stateDocuments = input.state_documents ?? [];

    if (input.project_alias && input.project_alias.trim().length > 0) {
      const project = dependencies.projects.require(input.project_alias.trim());
      const discovered = await autoDiscoverProjectEvidence(project.root);

      if (input.handoff === undefined || input.handoff.trim().length === 0) {
        handoff = discovered.handoff;
      }

      if (input.git_status === undefined || input.git_status.trim().length === 0) {
        gitStatus = discovered.gitStatus;
      }

      const documentMap = new Map<string, string>();
      for (const document of discovered.stateDocuments) {
        documentMap.set(document.path, document.content);
      }
      for (const document of (input.state_documents ?? [])) {
        documentMap.set(document.path, document.content);
      }
      stateDocuments = Array.from(documentMap.entries()).map(([path, content]) => ({ path, content }));
    }

    const evidence = assembleEvidence({
      deliverable: input.deliverable,
      handoff,
      stateDocuments,
      transcript: input.transcript,
      gitStatus,
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
