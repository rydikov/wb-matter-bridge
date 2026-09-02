export const matterDeviceTypes = [
  "on_off_light",
  "dimmable_light",
  "extended_color_light",
  "on_off_outlet",
  "temperature_sensor",
  "humidity_sensor",
  "occupancy_sensor",
  "contact_sensor",
  "environment_sensor",
  "heating_thermostat",
  "window_covering",
] as const;

export type MatterDeviceType = (typeof matterDeviceTypes)[number];
export type BindingValueType = "boolean" | "number" | "enum" | "rgb";

export interface ValueConverter {
  invert?: boolean;
  scale?: number;
  offset?: number;
  min?: number;
  max?: number;
  unit?: "raw" | "celsius" | "percent" | "kelvin" | "mired";
  trueValue?: string;
  falseValue?: string;
  enum?: Record<string, string | number | boolean>;
}

export interface AttributeBinding {
  stateTopic: string;
  commandTopic?: string;
  valueType: BindingValueType;
  converter?: ValueConverter;
}

export interface MatterDeviceConfig {
  id: string;
  endpointId: number | null;
  name: string;
  room?: string;
  type: MatterDeviceType;
  attributes: Record<string, AttributeBinding>;
}

export interface MqttConfig {
  url: string;
  clientId?: string;
  username?: string;
  password?: string;
  caFile?: string;
  certFile?: string;
  keyFile?: string;
  rejectUnauthorized?: boolean;
}

export interface BridgeConfig {
  name: string;
  vendorName: string;
  productName: string;
  port: number;
  uiPort: number;
  listenAddress: string;
}

export interface AppConfig {
  schemaVersion: 1;
  revision: number;
  mqtt: MqttConfig;
  bridge: BridgeConfig;
  devices: MatterDeviceConfig[];
}

export interface EndpointRegistry {
  nextEndpointId: number;
  assignments: Record<string, { endpointId: number; childEndpointIds?: number[]; type: MatterDeviceType }>;
  tombstones: number[];
}

export interface DeviceDraftResponse {
  devices: MatterDeviceConfig[];
  configRevision: number;
  draftRevision: number;
  dirty: boolean;
}

export interface ConfigDiff {
  added: Array<{ id: string; name: string; endpointId: number }>;
  updated: Array<{ id: string; name: string; endpointId: number }>;
  replaced: Array<{ id: string; name: string; oldEndpointId: number; newEndpointId: number }>;
  removed: Array<{ id: string; name: string; endpointId: number }>;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  devices: MatterDeviceConfig[];
  diff: ConfigDiff;
}

export interface MqttTopicInfo {
  topic: string;
  value?: string;
  updatedAt?: string;
  retained?: boolean;
  metadata: Record<string, unknown>;
  error?: string;
}

export interface BridgeStatus {
  startedAt: string;
  mqtt: { connected: boolean; url: string; topics: number; error?: string };
  matter: { started: boolean; commissioned: boolean; fabrics: number; error?: string };
  configRevision: number;
  deviceCount: number;
}
