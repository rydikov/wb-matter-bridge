import { describe, expect, it } from "vitest";
import type { AppConfig, EndpointRegistry, MatterDeviceConfig } from "../shared/types.js";
import { DraftManager, RevisionConflictError } from "./draftManager.js";

const bridge = { name: "Bridge", vendorName: "WB", productName: "Bridge", port: 5540, uiPort: 8787, listenAddress: "0.0.0.0" };
const binding = { stateTopic: "/devices/light/controls/state", commandTopic: "/devices/light/controls/state/on", valueType: "boolean" as const };
const configured: MatterDeviceConfig = { id: "one", endpointId: 2, name: "Свет", type: "on_off_light", attributes: { onOff: binding } };

function setup(devices: MatterDeviceConfig[] = [configured]) {
  const config: AppConfig = { schemaVersion: 1, revision: 3, mqtt: { url: "mqtt://localhost" }, bridge, devices };
  const registry: EndpointRegistry = { nextEndpointId: devices.length ? 3 : 2, assignments: devices.length ? { one: { endpointId: 2, type: "on_off_light" } } : {}, tombstones: [] };
  return { manager: new DraftManager(config, registry), registry };
}

describe("DraftManager", () => {
  it("keeps endpoint ID when editing the same type", () => {
    const { manager } = setup();
    manager.update("one", { name: "Новый свет", type: "on_off_light", attributes: { onOff: binding } }, 0);
    const prepared = manager.prepareCommit(1, 3);
    expect(prepared.config.devices[0].endpointId).toBe(2);
    expect(prepared.diff.updated).toHaveLength(1);
  });

  it("allocates a new endpoint and tombstones the old one on type replacement", () => {
    const { manager } = setup();
    manager.update("one", { name: "Розетка", type: "on_off_outlet", attributes: { onOff: binding } }, 0);
    const prepared = manager.prepareCommit(1, 3);
    expect(prepared.config.devices[0].endpointId).toBe(3);
    expect(prepared.registry.tombstones).toContain(2);
    expect(prepared.diff.replaced[0]).toMatchObject({ oldEndpointId: 2, newEndpointId: 3 });
  });

  it("reserves stable child endpoints for an environment sensor", () => {
    const { manager } = setup([]);
    manager.create({ name: "Климат", type: "environment_sensor", attributes: {
      temperature: { stateTopic: "/devices/s/controls/t", valueType: "number" },
      humidity: { stateTopic: "/devices/s/controls/h", valueType: "number" },
    } }, 0);
    const prepared = manager.prepareCommit(1, 3);
    const id = prepared.config.devices[0].id;
    expect(prepared.registry.assignments[id].childEndpointIds).toEqual([3, 4]);
    expect(prepared.registry.nextEndpointId).toBe(5);
  });

  it("detects concurrent draft edits", () => {
    const { manager } = setup();
    manager.delete("one", 0);
    expect(() => manager.discard(0)).toThrow(RevisionConflictError);
  });
});
