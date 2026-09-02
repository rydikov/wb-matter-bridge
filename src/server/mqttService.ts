import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import mqtt, { type IClientOptions, type MqttClient } from "mqtt";
import type { MqttConfig, MqttTopicInfo } from "../shared/types.js";
import { BridgeEventBus } from "./eventBus.js";

interface StateMessage { topic: string; value: string }

export class MqttService extends EventEmitter {
  private client?: MqttClient;
  private readonly topics = new Map<string, MqttTopicInfo>();
  private connected = false;
  private lastError?: string;

  constructor(private readonly config: MqttConfig, private readonly events: BridgeEventBus) { super(); }

  async start(): Promise<void> {
    const options: IClientOptions = {
      clientId: this.config.clientId ?? `wb-matter-bridge-${process.pid}`,
      username: this.config.username,
      password: this.config.password,
      reconnectPeriod: 2_000,
      connectTimeout: 10_000,
      clean: true,
      rejectUnauthorized: this.config.rejectUnauthorized ?? true,
    };
    if (this.config.caFile) options.ca = await readFile(this.config.caFile);
    if (this.config.certFile) options.cert = await readFile(this.config.certFile);
    if (this.config.keyFile) options.key = await readFile(this.config.keyFile);

    this.client = mqtt.connect(this.config.url, options);
    this.client.on("connect", () => {
      this.connected = true;
      this.lastError = undefined;
      this.client?.subscribe("/devices/#", { qos: 0 }, error => {
        if (error) this.recordError(error);
      });
      this.events.emitEvent("mqtt.connected");
      this.emit("connect");
    });
    this.client.on("close", () => {
      if (this.connected) {
        this.connected = false;
        this.events.emitEvent("mqtt.disconnected");
        this.emit("disconnect");
      }
    });
    this.client.on("error", error => this.recordError(error));
    this.client.on("message", (topic, payload, packet) => this.handleMessage(topic, payload.toString("utf8"), packet.retain));
  }

  async stop(): Promise<void> {
    if (!this.client) return;
    await this.client.endAsync();
    this.client = undefined;
    this.connected = false;
  }

  async publish(topic: string, value: string): Promise<void> {
    if (!this.client || !this.connected) throw new Error("MQTT broker недоступен");
    await this.client.publishAsync(topic, value, { qos: 1, retain: false });
    this.events.emitEvent("mqtt.command", { topic, value });
  }

  listTopics(): MqttTopicInfo[] {
    return [...this.topics.values()].sort((a, b) => a.topic.localeCompare(b.topic, "ru"));
  }

  get status(): { connected: boolean; url: string; topics: number; error?: string } {
    return { connected: this.connected, url: maskUrl(this.config.url), topics: this.topics.size, error: this.lastError };
  }

  private handleMessage(topic: string, value: string, retained: boolean): void {
    const parsed = parseControlTopic(topic);
    if (!parsed) return;
    const existing = this.topics.get(parsed.baseTopic) ?? { topic: parsed.baseTopic, metadata: {} };
    existing.updatedAt = new Date().toISOString();
    existing.retained = retained;
    if (parsed.kind === "state") {
      existing.value = value;
      this.emit("state", { topic, value } satisfies StateMessage);
    } else if (parsed.kind === "meta") {
      try {
        const metadata = JSON.parse(value) as Record<string, unknown>;
        existing.metadata = { ...existing.metadata, ...metadata };
        existing.error = typeof metadata.error === "string" && metadata.error ? metadata.error : undefined;
      } catch {
        existing.metadata.raw = value;
      }
    } else if (parsed.kind === "metaField") {
      existing.metadata[parsed.field] = parseMetadataValue(value);
      if (parsed.field === "error") existing.error = value || undefined;
    }
    this.topics.set(parsed.baseTopic, existing);
    this.emit("catalog", structuredClone(existing));
    this.events.emitEvent("mqtt.topic", { topic: parsed.baseTopic });
  }

  private recordError(error: Error): void {
    this.lastError = error.message;
    this.events.emitEvent("mqtt.error", { message: error.message });
  }
}

function parseControlTopic(topic: string): { baseTopic: string; kind: "state" | "meta" | "metaField"; field: string } | undefined {
  const match = topic.match(/^(\/devices\/[^/]+\/controls\/[^/]+)(?:\/(.*))?$/);
  if (!match) return undefined;
  const suffix = match[2];
  if (!suffix) return { baseTopic: match[1], kind: "state", field: "" };
  if (suffix === "meta") return { baseTopic: match[1], kind: "meta", field: "" };
  if (suffix.startsWith("meta/")) return { baseTopic: match[1], kind: "metaField", field: suffix.slice(5) };
  return undefined;
}

function parseMetadataValue(value: string): unknown {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) ? number : value;
}

function maskUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    return url.toString();
  } catch { return raw; }
}
