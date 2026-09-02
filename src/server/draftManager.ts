import { randomUUID } from "node:crypto";
import type { AppConfig, ConfigDiff, DeviceDraftResponse, EndpointRegistry, MatterDeviceConfig, ValidationResult } from "../shared/types.js";
import { cloneDevices } from "./configStore.js";
import { validateAppConfig } from "./validation.js";

export class RevisionConflictError extends Error {}
export class EntityNotFoundError extends Error {}

export class DraftManager {
  private draftDevices: MatterDeviceConfig[];
  private draftRevision = 0;

  constructor(private config: AppConfig, private registry: EndpointRegistry) {
    this.draftDevices = cloneDevices(config.devices);
  }

  snapshot(): DeviceDraftResponse {
    return {
      devices: cloneDevices(this.draftDevices),
      configRevision: this.config.revision,
      draftRevision: this.draftRevision,
      dirty: JSON.stringify(this.draftDevices) !== JSON.stringify(this.config.devices),
    };
  }

  create(input: Omit<MatterDeviceConfig, "id" | "endpointId">, expectedDraftRevision: number): MatterDeviceConfig {
    this.checkDraftRevision(expectedDraftRevision);
    const device: MatterDeviceConfig = { ...structuredClone(input), id: randomUUID(), endpointId: null };
    this.draftDevices.push(device);
    this.draftRevision++;
    return structuredClone(device);
  }

  update(id: string, input: Omit<MatterDeviceConfig, "id" | "endpointId">, expectedDraftRevision: number): MatterDeviceConfig {
    this.checkDraftRevision(expectedDraftRevision);
    const index = this.draftDevices.findIndex(device => device.id === id);
    if (index === -1) throw new EntityNotFoundError("Устройство не найдено");
    const previous = this.draftDevices[index];
    const endpointId = previous.type === input.type ? previous.endpointId : null;
    this.draftDevices[index] = { ...structuredClone(input), id, endpointId };
    this.draftRevision++;
    return structuredClone(this.draftDevices[index]);
  }

  delete(id: string, expectedDraftRevision: number): void {
    this.checkDraftRevision(expectedDraftRevision);
    const index = this.draftDevices.findIndex(device => device.id === id);
    if (index === -1) throw new EntityNotFoundError("Устройство не найдено");
    this.draftDevices.splice(index, 1);
    this.draftRevision++;
  }

  discard(expectedDraftRevision: number): DeviceDraftResponse {
    this.checkDraftRevision(expectedDraftRevision);
    this.draftDevices = cloneDevices(this.config.devices);
    this.draftRevision++;
    return this.snapshot();
  }

  validate(): ValidationResult {
    const prepared = this.prepare();
    const candidate: AppConfig = { ...this.config, devices: prepared.devices };
    const errors = validateAppConfig(candidate);
    return { valid: errors.length === 0, errors, warnings: [], devices: prepared.devices, diff: prepared.diff };
  }

  prepareCommit(expectedDraftRevision: number, expectedConfigRevision: number): { config: AppConfig; registry: EndpointRegistry; diff: ConfigDiff } {
    this.checkDraftRevision(expectedDraftRevision);
    if (expectedConfigRevision !== this.config.revision) throw new RevisionConflictError("Конфигурация уже была изменена");
    const prepared = this.prepare();
    const config: AppConfig = { ...structuredClone(this.config), revision: this.config.revision + 1, devices: prepared.devices };
    const errors = validateAppConfig(config);
    if (errors.length) throw new Error(errors.map(issue => `${issue.path}: ${issue.message}`).join("; "));
    return { config, registry: prepared.registry, diff: prepared.diff };
  }

  finishCommit(config: AppConfig, registry: EndpointRegistry): void {
    this.config = structuredClone(config);
    this.registry = structuredClone(registry);
    this.draftDevices = cloneDevices(config.devices);
    this.draftRevision++;
  }

  get activeConfig(): AppConfig { return structuredClone(this.config); }

  private prepare(): { devices: MatterDeviceConfig[]; registry: EndpointRegistry; diff: ConfigDiff } {
    const registry = structuredClone(this.registry);
    const activeById = new Map(this.config.devices.map(device => [device.id, device]));
    const draftIds = new Set(this.draftDevices.map(device => device.id));
    const diff: ConfigDiff = { added: [], updated: [], replaced: [], removed: [] };
    const devices = this.draftDevices.map(device => {
      const active = activeById.get(device.id);
      let endpointId = active?.type === device.type ? active.endpointId : null;
      if (endpointId === null) endpointId = registry.nextEndpointId++;
      const prepared = { ...structuredClone(device), endpointId };
      if (!active) diff.added.push({ id: device.id, name: device.name, endpointId });
      else if (active.type !== device.type) {
        if (active.endpointId !== null) registry.tombstones.push(active.endpointId, ...(registry.assignments[active.id]?.childEndpointIds ?? []));
        diff.replaced.push({ id: device.id, name: device.name, oldEndpointId: active.endpointId ?? -1, newEndpointId: endpointId });
      } else if (JSON.stringify(active) !== JSON.stringify(prepared)) diff.updated.push({ id: device.id, name: device.name, endpointId });
      const existingChildren = active?.type === device.type ? registry.assignments[device.id]?.childEndpointIds : undefined;
      const childEndpointIds = device.type === "environment_sensor"
        ? existingChildren ?? [registry.nextEndpointId++, registry.nextEndpointId++]
        : undefined;
      registry.assignments[device.id] = { endpointId, childEndpointIds, type: device.type };
      return prepared;
    });
    for (const active of this.config.devices) {
      if (draftIds.has(active.id)) continue;
      if (active.endpointId !== null) {
        registry.tombstones.push(active.endpointId, ...(registry.assignments[active.id]?.childEndpointIds ?? []));
        diff.removed.push({ id: active.id, name: active.name, endpointId: active.endpointId });
      }
      delete registry.assignments[active.id];
    }
    registry.tombstones = [...new Set(registry.tombstones)].sort((a, b) => a - b);
    return { devices, registry, diff };
  }

  private checkDraftRevision(expected: number): void {
    if (expected !== this.draftRevision) throw new RevisionConflictError("Черновик уже изменён в другой вкладке");
  }
}
