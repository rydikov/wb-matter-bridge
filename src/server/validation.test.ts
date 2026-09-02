import { describe, expect, it } from "vitest";
import type { AppConfig, MatterDeviceConfig } from "../shared/types.js";
import { validateAppConfig, validateDevice } from "./validation.js";

const light: MatterDeviceConfig = {
  id: "light-1", endpointId: 2, name: "Свет", room: "Кухня", type: "on_off_light",
  attributes: { onOff: { stateTopic: "/devices/light/controls/state", commandTopic: "/devices/light/controls/state/on", valueType: "boolean" } },
};

describe("configuration validation", () => {
  it("accepts a complete typed device", () => expect(validateDevice(light)).toEqual([]));

  it("rejects missing required attributes", () => {
    expect(validateDevice({ ...light, attributes: {} })[0].message).toMatch(/Обязательный атрибут/);
  });

  it("rejects unsupported attributes and wildcard topics", () => {
    const errors = validateDevice({ ...light, attributes: { onOff: { stateTopic: "/devices/+/state", valueType: "number" }, extra: { stateTopic: "/x", valueType: "number" } } });
    expect(errors.map(error => error.message).join(" ")).toMatch(/Ожидается тип boolean/);
    expect(errors.map(error => error.message).join(" ")).toMatch(/без wildcard/);
    expect(errors.map(error => error.message).join(" ")).toMatch(/не поддерживается/);
  });

  it("rejects duplicate endpoint IDs", () => {
    const config: AppConfig = {
      schemaVersion: 1, revision: 1,
      mqtt: { url: "mqtt://127.0.0.1:1883" },
      bridge: { name: "Bridge", vendorName: "WB", productName: "Bridge", port: 5540, uiPort: 8787, listenAddress: "0.0.0.0" },
      devices: [light, { ...light, id: "light-2" }],
    };
    expect(validateAppConfig(config).some(error => error.message.includes("Endpoint ID"))).toBe(true);
  });
});
