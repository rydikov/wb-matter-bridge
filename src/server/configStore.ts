import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig, EndpointRegistry, MatterDeviceConfig } from "../shared/types.js";
import { validateAppConfig } from "./validation.js";

const defaultConfig: AppConfig = {
  schemaVersion: 1,
  revision: 0,
  mqtt: { url: "mqtt://wb.local:1883" },
  bridge: {
    name: "Wiren Board Matter Bridge",
    vendorName: "Wiren Board",
    productName: "WB Matter Bridge",
    port: 5540,
    uiPort: 8787,
    listenAddress: "0.0.0.0",
  },
  devices: [],
};

const defaultRegistry: EndpointRegistry = { nextEndpointId: 2, assignments: {}, tombstones: [] };

export class ConfigStore {
  readonly configPath: string;
  readonly registryPath: string;
  readonly matterStoragePath: string;

  constructor(readonly dataDirectory: string) {
    this.configPath = path.join(dataDirectory, "config.json");
    this.registryPath = path.join(dataDirectory, "runtime", "endpoint-registry.json");
    this.matterStoragePath = path.join(dataDirectory, "runtime", "matter");
  }

  async initialize(): Promise<{ config: AppConfig; registry: EndpointRegistry }> {
    await mkdir(path.join(this.dataDirectory, "runtime"), { recursive: true });
    await mkdir(this.matterStoragePath, { recursive: true });
    const config = await this.readOrCreate(this.configPath, defaultConfig);
    const registry = await this.readOrCreate(this.registryPath, defaultRegistry);
    const errors = validateAppConfig(config);
    if (errors.length) throw new Error(`Некорректный config.json: ${errors.map(issue => `${issue.path}: ${issue.message}`).join("; ")}`);
    return { config, registry };
  }

  async commit(config: AppConfig, registry: EndpointRegistry): Promise<void> {
    await this.atomicWrite(this.registryPath, registry);
    await this.atomicWrite(this.configPath, config);
  }

  private async readOrCreate<T>(filename: string, defaultValue: T): Promise<T> {
    try {
      return JSON.parse(await readFile(filename, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.atomicWrite(filename, defaultValue);
      return structuredClone(defaultValue);
    }
  }

  private async atomicWrite(filename: string, value: unknown): Promise<void> {
    const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, filename);
  }
}

export function cloneDevices(devices: MatterDeviceConfig[]): MatterDeviceConfig[] {
  return structuredClone(devices);
}
