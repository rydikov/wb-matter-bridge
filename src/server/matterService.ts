import {
  Endpoint,
  ServerNode,
  VendorId,
  type EndpointType,
} from "@matter/main";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors/bridged-device-basic-information";
import { OccupancySensingServer } from "@matter/main/behaviors/occupancy-sensing";
import { ThermostatServer } from "@matter/main/behaviors/thermostat";
import { WindowCoveringServer } from "@matter/main/behaviors/window-covering";
import { ContactSensorDevice } from "@matter/main/devices/contact-sensor";
import { DimmableLightDevice } from "@matter/main/devices/dimmable-light";
import { ExtendedColorLightDevice } from "@matter/main/devices/extended-color-light";
import { HumiditySensorDevice } from "@matter/main/devices/humidity-sensor";
import { OccupancySensorDevice } from "@matter/main/devices/occupancy-sensor";
import { OnOffLightDevice } from "@matter/main/devices/on-off-light";
import { OnOffPlugInUnitDevice } from "@matter/main/devices/on-off-plug-in-unit";
import { TemperatureSensorDevice } from "@matter/main/devices/temperature-sensor";
import { ThermostatDevice } from "@matter/main/devices/thermostat";
import { WindowCoveringDevice } from "@matter/main/devices/window-covering";
import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";
import { BridgedNodeEndpoint } from "@matter/main/endpoints/bridged-node";
import { Thermostat } from "@matter/main/clusters/thermostat";
import { ColorControl } from "@matter/main/clusters/color-control";
import { WindowCovering } from "@matter/main/clusters/window-covering";
import type { AppConfig, AttributeBinding, EndpointRegistry, MatterDeviceConfig, MqttTopicInfo } from "../shared/types.js";
import {
  decodeMqttValue,
  encodeMqttValue,
  fromMatterPercent,
  fromMatterTemperature,
  kelvinToMired,
  miredToKelvin,
  rgbToXy,
  toMatterPercent,
  toMatterTemperature,
  xyToRgb,
  type RgbValue,
} from "./converters.js";
import { BridgeEventBus } from "./eventBus.js";
import { matterSerialNumber } from "./matterIdentifiers.js";
import { MqttService } from "./mqttService.js";

type AnyEndpoint = Endpoint<EndpointType>;

interface RuntimeDevice {
  device: MatterDeviceConfig;
  root: AnyEndpoint;
  attributeEndpoints: Record<string, AnyEndpoint>;
  confirmed: Map<string, unknown>;
  suppress: Set<string>;
  seen: Set<string>;
  errors: Map<string, string>;
}

export class MatterService {
  private server?: ServerNode;
  private aggregator?: AnyEndpoint;
  private readonly runtimeDevices = new Map<string, RuntimeDevice>();
  private readonly topicBindings = new Map<string, Array<{ record: RuntimeDevice; key: string }>>();
  private started = false;
  private lastError?: string;

  constructor(private readonly mqtt: MqttService, private readonly events: BridgeEventBus) {
    mqtt.on("state", ({ topic, value }: { topic: string; value: string }) => void this.onMqttState(topic, value));
    mqtt.on("catalog", (topic: MqttTopicInfo) => void this.onCatalogChange(topic));
    mqtt.on("disconnect", () => void this.setAllReachable(false));
  }

  async start(config: AppConfig, registry: EndpointRegistry): Promise<void> {
    try {
      this.server = await ServerNode.create({
        id: "wb-matter-bridge",
        network: { port: config.bridge.port },
        productDescription: { name: config.bridge.name, deviceType: AggregatorEndpoint.deviceType },
        basicInformation: {
          vendorName: config.bridge.vendorName,
          vendorId: VendorId(0xfff1),
          productName: config.bridge.productName,
          productLabel: config.bridge.productName,
          nodeLabel: config.bridge.name,
          productId: 0x8000,
          hardwareVersion: 1,
          hardwareVersionString: "WB8",
          softwareVersion: 1,
          softwareVersionString: "0.1.0",
          serialNumber: "wb-matter-bridge-001",
        },
      });
      this.aggregator = new Endpoint(AggregatorEndpoint, { id: "aggregator", number: 1 }) as AnyEndpoint;
      await this.server.add(this.aggregator);
      for (const device of config.devices) await this.addDevice(device, registry);
      this.rebuildTopicBindings();
      await this.hydrateFromCatalog();
      await this.server.start();
      this.started = true;
      this.events.emitEvent("matter.started", this.commissioningInfo());
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.events.emitEvent("matter.error", { message: this.lastError });
      await this.server?.close().catch(() => undefined);
      this.server = undefined;
      this.aggregator = undefined;
      this.runtimeDevices.clear();
      this.topicBindings.clear();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.server) await this.server.close();
    this.server = undefined;
    this.aggregator = undefined;
    this.runtimeDevices.clear();
    this.topicBindings.clear();
    this.started = false;
  }

  async apply(config: AppConfig, registry: EndpointRegistry): Promise<void> {
    if (!this.aggregator) throw new Error("Matter bridge не запущен");
    const nextIds = new Set(config.devices.map(device => device.id));
    for (const [id, record] of this.runtimeDevices) {
      const replacement = config.devices.find(device => device.id === id);
      if (!nextIds.has(id) || replacement?.type !== record.device.type) {
        await record.root.close();
        this.runtimeDevices.delete(id);
      }
    }
    for (const device of config.devices) {
      const record = this.runtimeDevices.get(device.id);
      if (!record) await this.addDevice(device, registry);
      else {
        const previousAttributes = record.device.attributes;
        record.device = structuredClone(device);
        for (const [key, binding] of Object.entries(device.attributes)) {
          if (previousAttributes[key]?.stateTopic !== binding.stateTopic) {
            record.seen.delete(key);
            record.confirmed.delete(key);
            record.errors.delete(key);
          }
        }
        for (const key of record.seen) {
          if (!device.attributes[key]) {
            record.seen.delete(key);
            record.confirmed.delete(key);
            record.errors.delete(key);
          }
        }
        await record.root.setStateOf("bridgedDeviceBasicInformation", this.bridgedInformation(device));
      }
    }
    this.rebuildTopicBindings();
    await this.hydrateFromCatalog();
    this.events.emitEvent("matter.endpoints.changed", { count: config.devices.length });
  }

  status(): { started: boolean; commissioned: boolean; fabrics: number; error?: string } {
    if (!this.server) return { started: false, commissioned: false, fabrics: 0, error: this.lastError };
    const commissioning = (this.server.state as Record<string, any>).commissioning ?? {};
    return {
      started: this.started,
      commissioned: Boolean(commissioning.commissioned),
      fabrics: Object.keys(commissioning.fabrics ?? {}).length,
      error: this.lastError,
    };
  }

  commissioningInfo(): { commissioned: boolean; fabrics: number; qrPairingCode?: string; manualPairingCode?: string } {
    if (!this.server) return { commissioned: false, fabrics: 0 };
    const commissioning = (this.server.state as Record<string, any>).commissioning ?? {};
    const codes = commissioning.pairingCodes ?? {};
    return {
      commissioned: Boolean(commissioning.commissioned),
      fabrics: Object.keys(commissioning.fabrics ?? {}).length,
      qrPairingCode: codes.qrPairingCode,
      manualPairingCode: codes.manualPairingCode,
    };
  }

  async openCommissioningWindow(): Promise<ReturnType<MatterService["commissioningInfo"]>> {
    const info = this.commissioningInfo();
    if (info.commissioned) {
      throw new Error("Для добавления второго администратора откройте commissioning window из уже подключённого Matter-контроллера");
    }
    return info;
  }

  async factoryReset(): Promise<void> {
    if (!this.server) throw new Error("Matter bridge не запущен");
    await this.server.erase();
    this.events.emitEvent("matter.factory-reset");
  }

  private async addDevice(device: MatterDeviceConfig, registry: EndpointRegistry): Promise<void> {
    if (!this.aggregator || device.endpointId === null) throw new Error(`У устройства ${device.name} нет endpoint ID`);
    const info = this.bridgedInformation(device);
    let root: AnyEndpoint;
    let attributeEndpoints: Record<string, AnyEndpoint>;
    if (device.type === "environment_sensor") {
      const children = registry.assignments[device.id]?.childEndpointIds;
      if (!children || children.length !== 2) throw new Error(`Нет дочерних endpoint ID для ${device.name}`);
      root = new Endpoint(BridgedNodeEndpoint, {
        id: `device-${device.id}`,
        number: device.endpointId,
        bridgedDeviceBasicInformation: info,
      }) as AnyEndpoint;
      const temperature = new Endpoint(TemperatureSensorDevice, { id: "temperature", number: children[0] }) as AnyEndpoint;
      const humidity = new Endpoint(HumiditySensorDevice, { id: "humidity", number: children[1] }) as AnyEndpoint;
      await this.aggregator.add(root);
      await root.add(temperature);
      await root.add(humidity);
      attributeEndpoints = { temperature, humidity };
    } else {
      const type = this.endpointType(device.type);
      root = new Endpoint(type, {
        id: `device-${device.id}`,
        number: device.endpointId,
        bridgedDeviceBasicInformation: info,
        ...(device.type === "extended_color_light" ? {
          colorControl: {
            colorMode: ColorControl.ColorMode.CurrentXAndCurrentY,
            enhancedColorMode: ColorControl.EnhancedColorMode.CurrentXAndCurrentY,
            colorTemperatureMireds: 250,
            colorTempPhysicalMinMireds: 100,
            colorTempPhysicalMaxMireds: 1000,
            coupleColorTempToLevelMinMireds: 100,
          },
        } : {}),
        ...(device.type === "heating_thermostat" ? {
          thermostat: {
            localTemperature: null,
            controlSequenceOfOperation: Thermostat.ControlSequenceOfOperation.HeatingOnly,
            systemMode: Thermostat.SystemMode.Off,
            occupiedHeatingSetpoint: 2000,
          },
        } : {}),
      } as any) as AnyEndpoint;
      await this.aggregator.add(root);
      attributeEndpoints = Object.fromEntries(Object.keys(device.attributes).map(key => [key, root]));
    }
    const record: RuntimeDevice = {
      device: structuredClone(device), root, attributeEndpoints,
      confirmed: new Map(), suppress: new Set(), seen: new Set(), errors: new Map(),
    };
    this.runtimeDevices.set(device.id, record);
    this.registerCommandObservers(record);
  }

  private endpointType(type: MatterDeviceConfig["type"]): any {
    const bridged = BridgedDeviceBasicInformationServer;
    switch (type) {
      case "on_off_light": return OnOffLightDevice.with(bridged);
      case "dimmable_light": return DimmableLightDevice.with(bridged);
      case "extended_color_light": return ExtendedColorLightDevice.with(bridged);
      case "on_off_outlet": return OnOffPlugInUnitDevice.with(bridged);
      case "temperature_sensor": return TemperatureSensorDevice.with(bridged);
      case "humidity_sensor": return HumiditySensorDevice.with(bridged);
      case "contact_sensor": return ContactSensorDevice.with(bridged);
      case "occupancy_sensor": return OccupancySensorDevice.with(OccupancySensingServer.with("PassiveInfrared", "OccupancyEvent"), bridged);
      case "heating_thermostat": return ThermostatDevice.with(ThermostatServer.with("Heating"), bridged);
      case "window_covering": return WindowCoveringDevice.with(WindowCoveringServer.with("Lift", "PositionAwareLift"), bridged);
      default: throw new Error(`Неподдерживаемый Matter-тип: ${type}`);
    }
  }

  private bridgedInformation(device: MatterDeviceConfig) {
    return {
      nodeLabel: device.name,
      productName: device.name,
      productLabel: device.name,
      serialNumber: matterSerialNumber(device.id),
      reachable: false,
    };
  }

  private rebuildTopicBindings(): void {
    this.topicBindings.clear();
    for (const record of this.runtimeDevices.values()) {
      for (const [key, binding] of Object.entries(record.device.attributes)) {
        const bindings = this.topicBindings.get(binding.stateTopic) ?? [];
        bindings.push({ record, key });
        this.topicBindings.set(binding.stateTopic, bindings);
      }
    }
  }

  private async hydrateFromCatalog(): Promise<void> {
    for (const topic of this.mqtt.listTopics()) {
      if (topic.value !== undefined) await this.onMqttState(topic.topic, topic.value);
      await this.onCatalogChange(topic);
    }
  }

  private async onMqttState(topic: string, raw: string): Promise<void> {
    for (const { record, key } of this.topicBindings.get(topic) ?? []) {
      const binding = record.device.attributes[key];
      try {
        const decoded = decodeMqttValue(raw, binding);
        await this.applyAttributeState(record, key, decoded);
        record.seen.add(key);
        record.errors.delete(key);
        await this.updateReachability(record);
      } catch (error) {
        record.errors.set(key, error instanceof Error ? error.message : String(error));
        await this.updateReachability(record);
        this.events.emitEvent("binding.error", { deviceId: record.device.id, attribute: key, message: record.errors.get(key) });
      }
    }
  }

  private async onCatalogChange(topic: MqttTopicInfo): Promise<void> {
    for (const { record, key } of this.topicBindings.get(topic.topic) ?? []) {
      if (topic.error && /[rwp]/.test(topic.error)) record.errors.set(key, topic.error);
      else if (record.errors.get(key)?.match(/^[rwp]+$/)) record.errors.delete(key);
      await this.updateReachability(record);
    }
  }

  private async applyAttributeState(record: RuntimeDevice, key: string, value: unknown): Promise<void> {
    const endpoint = record.attributeEndpoints[key] ?? record.root;
    record.suppress.add(key);
    try {
      switch (key) {
        case "onOff": await endpoint.setStateOf("onOff", { onOff: Boolean(value) }); break;
        case "level": await endpoint.setStateOf("levelControl", { currentLevel: Math.round((Number(value) / 100) * 254) }); break;
        case "rgb": {
          const xy = rgbToXy(value as RgbValue);
          await endpoint.setStateOf("colorControl", { currentX: Math.round(xy.x * 0xfeff), currentY: Math.round(xy.y * 0xfeff) });
          break;
        }
        case "colorTemperature": {
          const binding = record.device.attributes[key];
          const mired = binding.converter?.unit === "kelvin" ? kelvinToMired(Number(value)) : Number(value);
          await endpoint.setStateOf("colorControl", { colorTemperatureMireds: Math.round(mired) });
          break;
        }
        case "temperature": await endpoint.setStateOf("temperatureMeasurement", { measuredValue: toMatterTemperature(Number(value)) }); break;
        case "humidity": await endpoint.setStateOf("relativeHumidityMeasurement", { measuredValue: toMatterPercent(Number(value)) }); break;
        case "occupancy": await endpoint.setStateOf("occupancySensing", { occupancy: { occupied: Boolean(value) } }); break;
        case "contact": await endpoint.setStateOf("booleanState", { stateValue: Boolean(value) }); break;
        case "localTemperature": await endpoint.setStateOf("thermostat", { localTemperature: toMatterTemperature(Number(value)) }); break;
        case "heatingSetpoint": await endpoint.setStateOf("thermostat", { occupiedHeatingSetpoint: toMatterTemperature(Number(value)) }); break;
        case "systemMode": await endpoint.setStateOf("thermostat", { systemMode: normalizeSystemMode(value) }); break;
        case "heatingActive": await endpoint.setStateOf("thermostat", { thermostatRunningState: new Thermostat.RelayState({ heat: Boolean(value) }) }); break;
        case "currentPosition": await endpoint.setStateOf("windowCovering", { currentPositionLiftPercent100ths: toMatterPercent(Number(value)) }); break;
        case "targetPosition": await endpoint.setStateOf("windowCovering", { targetPositionLiftPercent100ths: toMatterPercent(Number(value)) }); break;
        case "operationalStatus": await endpoint.setStateOf("windowCovering", { operationalStatus: new WindowCovering.OperationalStatus({ global: normalizeMovement(value), lift: normalizeMovement(value) }) }); break;
      }
      record.confirmed.set(key, value);
    } finally {
      record.suppress.delete(key);
    }
  }

  private registerCommandObservers(record: RuntimeDevice): void {
    const endpoint = record.root as any;
    const watch = (behavior: string, event: string, key: string, transform: (value: any) => unknown = value => value) => {
      endpoint.events?.[behavior]?.[event]?.on((value: unknown) => {
        if (record.suppress.has(key)) return;
        void this.handleMatterCommand(record, key, transform(value));
      });
    };
    watch("onOff", "onOff$Changed", "onOff");
    watch("levelControl", "currentLevel$Changed", "level", value => (Number(value) / 254) * 100);
    watch("colorControl", "currentX$Changed", "rgb", () => this.currentRgb(record));
    watch("colorControl", "currentY$Changed", "rgb", () => this.currentRgb(record));
    watch("colorControl", "colorTemperatureMireds$Changed", "colorTemperature", value => {
      return record.device.attributes.colorTemperature?.converter?.unit === "kelvin" ? miredToKelvin(Number(value)) : Number(value);
    });
    watch("thermostat", "occupiedHeatingSetpoint$Changed", "heatingSetpoint", value => fromMatterTemperature(Number(value)));
    watch("thermostat", "systemMode$Changed", "systemMode");
    watch("windowCovering", "targetPositionLiftPercent100ths$Changed", "targetPosition", value => fromMatterPercent(Number(value)));
  }

  private currentRgb(record: RuntimeDevice): RgbValue {
    const state = record.root.stateOf("colorControl") as Record<string, any>;
    const level = (record.root.maybeStateOf("levelControl") as Record<string, any> | undefined)?.currentLevel ?? 254;
    return xyToRgb(Number(state.currentX ?? 0) / 0xfeff, Number(state.currentY ?? 0) / 0xfeff, (Number(level) / 254) * 100);
  }

  private async handleMatterCommand(record: RuntimeDevice, key: string, value: unknown): Promise<void> {
    const binding = record.device.attributes[key];
    if (!binding?.commandTopic) return;
    try {
      await this.mqtt.publish(binding.commandTopic, encodeMqttValue(value, binding));
      this.events.emitEvent("matter.command", { deviceId: record.device.id, attribute: key });
      const confirmed = record.confirmed.get(key);
      if (confirmed !== undefined) await this.applyAttributeState(record, key, confirmed);
      if (key === "targetPosition" && record.confirmed.has("currentPosition")) {
        await this.applyAttributeState(record, "currentPosition", record.confirmed.get("currentPosition"));
      }
    } catch (error) {
      this.events.emitEvent("matter.command-error", { deviceId: record.device.id, attribute: key, message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async updateReachability(record: RuntimeDevice): Promise<void> {
    const keys = Object.keys(record.device.attributes);
    const reachable = this.mqtt.status.connected && keys.every(key => record.seen.has(key) && !record.errors.has(key));
    await record.root.setStateOf("bridgedDeviceBasicInformation", { reachable });
  }

  private async setAllReachable(reachable: boolean): Promise<void> {
    await Promise.all([...this.runtimeDevices.values()].map(record => record.root.setStateOf("bridgedDeviceBasicInformation", { reachable })));
  }
}

function normalizeSystemMode(value: unknown): Thermostat.SystemMode {
  if (typeof value === "number") return value as Thermostat.SystemMode;
  const normalized = String(value).toLowerCase();
  return normalized === "heat" || normalized === "on" || normalized === "1" ? Thermostat.SystemMode.Heat : Thermostat.SystemMode.Off;
}

function normalizeMovement(value: unknown): WindowCovering.MovementStatus {
  if (typeof value === "number") return value as WindowCovering.MovementStatus;
  switch (String(value).toLowerCase()) {
    case "opening": case "open": case "1": return WindowCovering.MovementStatus.Opening;
    case "closing": case "close": case "2": return WindowCovering.MovementStatus.Closing;
    default: return WindowCovering.MovementStatus.Stopped;
  }
}
