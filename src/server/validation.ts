import Ajv from "ajv/dist/ajv.js";
import { configSchema } from "../shared/configSchema.js";
import { deviceTemplates } from "../shared/deviceTemplates.js";
import type { AppConfig, MatterDeviceConfig, ValidationIssue } from "../shared/types.js";

const ajv = new (Ajv as any)({ allErrors: true, strict: false });
const validateSchema = ajv.compile(configSchema);

function pathFor(device: MatterDeviceConfig, suffix = ""): string {
  return `/devices/${device.id}${suffix}`;
}

export function validateAppConfig(config: AppConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!validateSchema(config)) {
    for (const error of validateSchema.errors ?? []) {
      issues.push({ path: error.instancePath || "/", message: error.message ?? "Некорректное значение" });
    }
    return issues;
  }

  const ids = new Set<string>();
  const endpointIds = new Set<number>();
  for (const device of config.devices) {
    if (ids.has(device.id)) issues.push({ path: pathFor(device, "/id"), message: "ID устройства должен быть уникальным" });
    ids.add(device.id);
    if (device.endpointId !== null) {
      if (endpointIds.has(device.endpointId)) issues.push({ path: pathFor(device, "/endpointId"), message: "Endpoint ID должен быть уникальным" });
      endpointIds.add(device.endpointId);
    }
    issues.push(...validateDevice(device));
  }
  return issues;
}

export function validateDevice(device: MatterDeviceConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const template = deviceTemplates[device.type];
  if (!template) return [{ path: pathFor(device, "/type"), message: "Неизвестный Matter-тип" }];

  const definitions = new Map(template.attributes.map(attribute => [attribute.key, attribute]));
  for (const definition of template.attributes) {
    const binding = device.attributes[definition.key];
    if (definition.required && !binding) {
      issues.push({ path: pathFor(device, `/attributes/${definition.key}`), message: `Обязательный атрибут «${definition.label}» не настроен` });
      continue;
    }
    if (!binding) continue;
    if (binding.valueType !== definition.valueType) {
      issues.push({ path: pathFor(device, `/attributes/${definition.key}/valueType`), message: `Ожидается тип ${definition.valueType}` });
    }
    if (!isExactTopic(binding.stateTopic)) {
      issues.push({ path: pathFor(device, `/attributes/${definition.key}/stateTopic`), message: "Нужен точный MQTT-топик без wildcard" });
    }
    if (definition.writable && !binding.commandTopic) {
      issues.push({ path: pathFor(device, `/attributes/${definition.key}/commandTopic`), message: "Для управляемого атрибута нужен command topic" });
    }
    if (!definition.writable && binding.commandTopic) {
      issues.push({ path: pathFor(device, `/attributes/${definition.key}/commandTopic`), message: "Read-only атрибут не поддерживает command topic" });
    }
    if (binding.commandTopic && !isExactTopic(binding.commandTopic)) {
      issues.push({ path: pathFor(device, `/attributes/${definition.key}/commandTopic`), message: "Нужен точный MQTT-топик без wildcard" });
    }
    const converter = binding.converter;
    if (converter?.scale === 0) {
      issues.push({ path: pathFor(device, `/attributes/${definition.key}/converter/scale`), message: "Scale не может быть равен нулю" });
    }
    if (converter?.min !== undefined && converter?.max !== undefined && converter.min >= converter.max) {
      issues.push({ path: pathFor(device, `/attributes/${definition.key}/converter`), message: "Min должен быть меньше max" });
    }
  }
  for (const key of Object.keys(device.attributes)) {
    if (!definitions.has(key)) issues.push({ path: pathFor(device, `/attributes/${key}`), message: "Атрибут не поддерживается выбранным Matter-типом" });
  }
  if (device.type === "extended_color_light" && !device.attributes.rgb && !device.attributes.colorTemperature) {
    issues.push({ path: pathFor(device, "/attributes"), message: "Для цветного света нужен RGB или цветовая температура" });
  }
  return issues;
}

function isExactTopic(topic: string): boolean {
  return topic.startsWith("/") && topic.length > 1 && !topic.includes("#") && !topic.includes("+") && !topic.includes("\0");
}
