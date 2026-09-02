import type { BindingValueType, MatterDeviceType } from "./types.js";

export interface AttributeDefinition {
  key: string;
  label: string;
  valueType: BindingValueType;
  required: boolean;
  writable: boolean;
  defaultUnit?: "raw" | "celsius" | "percent" | "kelvin" | "mired";
  min?: number;
  max?: number;
}

export interface DeviceTemplate {
  type: MatterDeviceType;
  label: string;
  attributes: AttributeDefinition[];
}

export const deviceTemplates: Record<MatterDeviceType, DeviceTemplate> = {
  on_off_light: {
    type: "on_off_light",
    label: "Свет: вкл/выкл",
    attributes: [{ key: "onOff", label: "Состояние", valueType: "boolean", required: true, writable: true }],
  },
  dimmable_light: {
    type: "dimmable_light",
    label: "Диммируемый свет",
    attributes: [
      { key: "onOff", label: "Состояние", valueType: "boolean", required: true, writable: true },
      { key: "level", label: "Яркость", valueType: "number", required: true, writable: true, defaultUnit: "percent", min: 0, max: 100 },
    ],
  },
  extended_color_light: {
    type: "extended_color_light",
    label: "Цветной свет RGB/CCT",
    attributes: [
      { key: "onOff", label: "Состояние", valueType: "boolean", required: true, writable: true },
      { key: "level", label: "Яркость", valueType: "number", required: true, writable: true, defaultUnit: "percent", min: 0, max: 100 },
      { key: "rgb", label: "RGB (R;G;B)", valueType: "rgb", required: false, writable: true },
      { key: "colorTemperature", label: "Цветовая температура", valueType: "number", required: false, writable: true, defaultUnit: "kelvin", min: 1000, max: 10000 },
    ],
  },
  on_off_outlet: {
    type: "on_off_outlet",
    label: "Розетка / реле",
    attributes: [{ key: "onOff", label: "Состояние", valueType: "boolean", required: true, writable: true }],
  },
  temperature_sensor: {
    type: "temperature_sensor",
    label: "Датчик температуры",
    attributes: [{ key: "temperature", label: "Температура", valueType: "number", required: true, writable: false, defaultUnit: "celsius", min: -273.15, max: 327.67 }],
  },
  humidity_sensor: {
    type: "humidity_sensor",
    label: "Датчик влажности",
    attributes: [{ key: "humidity", label: "Влажность", valueType: "number", required: true, writable: false, defaultUnit: "percent", min: 0, max: 100 }],
  },
  occupancy_sensor: {
    type: "occupancy_sensor",
    label: "Датчик движения",
    attributes: [{ key: "occupancy", label: "Движение", valueType: "boolean", required: true, writable: false }],
  },
  contact_sensor: {
    type: "contact_sensor",
    label: "Датчик контакта",
    attributes: [{ key: "contact", label: "Контакт", valueType: "boolean", required: true, writable: false }],
  },
  environment_sensor: {
    type: "environment_sensor",
    label: "Датчик климата",
    attributes: [
      { key: "temperature", label: "Температура", valueType: "number", required: true, writable: false, defaultUnit: "celsius", min: -273.15, max: 327.67 },
      { key: "humidity", label: "Влажность", valueType: "number", required: true, writable: false, defaultUnit: "percent", min: 0, max: 100 },
    ],
  },
  heating_thermostat: {
    type: "heating_thermostat",
    label: "Термостат отопления",
    attributes: [
      { key: "localTemperature", label: "Текущая температура", valueType: "number", required: true, writable: false, defaultUnit: "celsius", min: -273.15, max: 327.67 },
      { key: "heatingSetpoint", label: "Уставка", valueType: "number", required: true, writable: true, defaultUnit: "celsius", min: 5, max: 35 },
      { key: "systemMode", label: "Режим Off/Heat", valueType: "enum", required: true, writable: true },
      { key: "heatingActive", label: "Нагрев активен", valueType: "boolean", required: false, writable: false },
    ],
  },
  window_covering: {
    type: "window_covering",
    label: "Штора / жалюзи",
    attributes: [
      { key: "currentPosition", label: "Текущая позиция", valueType: "number", required: true, writable: false, defaultUnit: "percent", min: 0, max: 100 },
      { key: "targetPosition", label: "Целевая позиция", valueType: "number", required: true, writable: true, defaultUnit: "percent", min: 0, max: 100 },
      { key: "operationalStatus", label: "Состояние движения", valueType: "enum", required: false, writable: false },
    ],
  },
};

export function templateFor(type: MatterDeviceType): DeviceTemplate {
  return deviceTemplates[type];
}
