import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const directory = process.argv[2];
if (!directory) throw new Error("Usage: node scripts/create-smoke-data.mjs <directory>");

const bool = (name, writable = false) => ({ stateTopic: `/devices/smoke/controls/${name}`, ...(writable ? { commandTopic: `/devices/smoke/controls/${name}/on` } : {}), valueType: "boolean" });
const num = (name, writable = false, unit = "raw") => ({ stateTopic: `/devices/smoke/controls/${name}`, ...(writable ? { commandTopic: `/devices/smoke/controls/${name}/on` } : {}), valueType: "number", converter: { unit, scale: 1, offset: 0 } });
const enumeration = (name, writable = false) => ({ stateTopic: `/devices/smoke/controls/${name}`, ...(writable ? { commandTopic: `/devices/smoke/controls/${name}/on` } : {}), valueType: "enum" });
const specs = [
  ["on_off_light", { onOff: bool("light", true) }],
  ["dimmable_light", { onOff: bool("dimmer", true), level: num("level", true, "percent") }],
  ["extended_color_light", { onOff: bool("color", true), level: num("color_level", true, "percent"), rgb: { ...bool("rgb", true), valueType: "rgb" } }],
  ["on_off_outlet", { onOff: bool("outlet", true) }],
  ["temperature_sensor", { temperature: num("temperature", false, "celsius") }],
  ["humidity_sensor", { humidity: num("humidity", false, "percent") }],
  ["occupancy_sensor", { occupancy: bool("occupancy") }],
  ["contact_sensor", { contact: bool("contact") }],
  ["environment_sensor", { temperature: num("env_temperature", false, "celsius"), humidity: num("env_humidity", false, "percent") }],
  ["heating_thermostat", { localTemperature: num("local_temperature", false, "celsius"), heatingSetpoint: num("setpoint", true, "celsius"), systemMode: enumeration("mode", true) }],
  ["window_covering", { currentPosition: num("position", false, "percent"), targetPosition: num("target", true, "percent") }],
];

let endpoint = 2;
const assignments = {};
const devices = specs.map(([type, attributes], index) => {
  const id = `smoke-${type}`;
  const endpointId = endpoint++;
  const childEndpointIds = type === "environment_sensor" ? [endpoint++, endpoint++] : undefined;
  assignments[id] = { endpointId, ...(childEndpointIds ? { childEndpointIds } : {}), type };
  return { id, endpointId, name: `Smoke ${index + 1}`, room: "Test", type, attributes };
});
const config = {
  schemaVersion: 1,
  revision: 1,
  mqtt: { url: "mqtt://wb.local:1883" },
  bridge: { name: "WB Matter Smoke", vendorName: "Wiren Board", productName: "WB Matter Bridge", port: 5540, uiPort: 8787, listenAddress: "127.0.0.1" },
  devices,
};
const registry = { nextEndpointId: endpoint, assignments, tombstones: [] };
await mkdir(path.join(directory, "runtime"), { recursive: true });
await writeFile(path.join(directory, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
await writeFile(path.join(directory, "runtime", "endpoint-registry.json"), `${JSON.stringify(registry, null, 2)}\n`);
console.log(`Created ${devices.length} devices with endpoints 2..${endpoint - 1} in ${directory}`);
