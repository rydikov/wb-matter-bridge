import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { MatterDeviceConfig } from "../shared/types.js";
import { configSchema } from "../shared/configSchema.js";
import { deviceTemplates } from "../shared/deviceTemplates.js";
import { ConfigStore } from "./configStore.js";
import { DraftManager, EntityNotFoundError, RevisionConflictError } from "./draftManager.js";
import { BridgeEventBus, type BridgeEvent } from "./eventBus.js";
import { MatterService } from "./matterService.js";
import { MqttService } from "./mqttService.js";
import { isOriginAllowed } from "./requestSecurity.js";

interface DeviceMutationBody {
  device: Omit<MatterDeviceConfig, "id" | "endpointId">;
  expectedDraftRevision: number;
}

export async function createApi(options: {
  store: ConfigStore;
  drafts: DraftManager;
  mqtt: MqttService;
  matter: MatterService;
  events: BridgeEventBus;
}): Promise<FastifyInstance> {
  const { store, drafts, mqtt, matter, events } = options;
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, trustProxy: false });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:");
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const origin = request.headers.origin;
      if (!isOriginAllowed(origin, request.headers.host, process.env.WB_ALLOWED_ORIGINS)) {
        return reply.code(403).send({ error: "Origin не разрешён" });
      }
      if (request.method !== "DELETE" && !request.headers["content-type"]?.startsWith("application/json")) {
        return reply.code(415).send({ error: "Требуется Content-Type: application/json" });
      }
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RevisionConflictError) return reply.code(409).send({ error: error.message, snapshot: drafts.snapshot() });
    if (error instanceof EntityNotFoundError) return reply.code(404).send({ error: error.message });
    app.log.error(error);
    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  });

  app.get("/api/v1/health", async () => ({ ok: true }));
  app.get("/api/v1/status", async () => {
    const config = drafts.activeConfig;
    return {
      startedAt: process.env.WB_STARTED_AT,
      mqtt: mqtt.status,
      matter: matter.status(),
      configRevision: config.revision,
      deviceCount: config.devices.length,
    };
  });
  app.get("/api/v1/config", async () => {
    const config = drafts.activeConfig;
    return { ...config, mqtt: { ...config.mqtt, password: config.mqtt.password ? "***" : undefined } };
  });
  app.get("/api/v1/schema/config", async () => configSchema);
  app.get("/api/v1/device-types", async () => deviceTemplates);
  app.get("/api/v1/devices", async () => drafts.snapshot());
  app.post<{ Body: DeviceMutationBody }>("/api/v1/devices", async (request, reply) => {
    const device = drafts.create(request.body.device, request.body.expectedDraftRevision);
    events.emitEvent("draft.created", { id: device.id });
    return reply.code(201).send({ device, draft: drafts.snapshot() });
  });
  app.put<{ Params: { id: string }; Body: DeviceMutationBody }>("/api/v1/devices/:id", async request => {
    const device = drafts.update(request.params.id, request.body.device, request.body.expectedDraftRevision);
    events.emitEvent("draft.updated", { id: device.id });
    return { device, draft: drafts.snapshot() };
  });
  app.delete<{ Params: { id: string }; Querystring: { expectedDraftRevision: string } }>("/api/v1/devices/:id", async request => {
    drafts.delete(request.params.id, Number(request.query.expectedDraftRevision));
    events.emitEvent("draft.deleted", { id: request.params.id });
    return drafts.snapshot();
  });
  app.post<{ Body: { expectedDraftRevision: number } }>("/api/v1/config/discard", async request => {
    events.emitEvent("draft.discarded");
    return drafts.discard(request.body.expectedDraftRevision);
  });
  app.post("/api/v1/config/validate", async () => drafts.validate());
  app.post<{ Body: { expectedDraftRevision: number; expectedConfigRevision: number } }>("/api/v1/config/apply", async request => {
    const previousConfig = drafts.activeConfig;
    const previousRegistry = (await store.initialize()).registry;
    const prepared = drafts.prepareCommit(request.body.expectedDraftRevision, request.body.expectedConfigRevision);
    try {
      await matter.apply(prepared.config, prepared.registry);
      await store.commit(prepared.config, prepared.registry);
      drafts.finishCommit(prepared.config, prepared.registry);
    } catch (error) {
      await matter.apply(previousConfig, previousRegistry).catch(rollbackError => app.log.error(rollbackError, "Matter rollback failed"));
      throw error;
    }
    events.emitEvent("config.applied", prepared.diff);
    return { configRevision: prepared.config.revision, draft: drafts.snapshot(), diff: prepared.diff };
  });
  app.get("/api/v1/mqtt/topics", async () => mqtt.listTopics());
  app.get("/api/v1/matter/commissioning", async () => matter.commissioningInfo());
  app.post("/api/v1/matter/commissioning/open", async () => matter.openCommissioningWindow());
  app.post<{ Body: { confirmation: string } }>("/api/v1/matter/reset", async request => {
    if (request.body.confirmation !== "СБРОСИТЬ MATTER") throw new Error("Неверная подтверждающая строка");
    await matter.factoryReset();
    return matter.commissioningInfo();
  });
  app.get("/api/v1/events", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: BridgeEvent) => reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 20_000);
    events.on("event", send);
    request.raw.on("close", () => { clearInterval(heartbeat); events.off("event", send); });
  });

  const webRoot = path.resolve("dist/web");
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });
    app.get("/*", async (_request, reply) => reply.sendFile("index.html"));
  }
  return app;
}
