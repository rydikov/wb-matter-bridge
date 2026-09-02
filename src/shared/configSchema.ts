import { matterDeviceTypes } from "./types.js";

export const configSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "revision", "mqtt", "bridge", "devices"],
  properties: {
    schemaVersion: { type: "number", const: 1 },
    revision: { type: "integer", minimum: 0 },
    mqtt: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: {
        url: { type: "string", minLength: 1 },
        clientId: { type: "string", nullable: true },
        username: { type: "string", nullable: true },
        password: { type: "string", nullable: true },
        caFile: { type: "string", nullable: true },
        certFile: { type: "string", nullable: true },
        keyFile: { type: "string", nullable: true },
        rejectUnauthorized: { type: "boolean", nullable: true },
      },
    },
    bridge: {
      type: "object",
      additionalProperties: false,
      required: ["name", "vendorName", "productName", "port", "uiPort", "listenAddress"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 32 },
        vendorName: { type: "string", minLength: 1, maxLength: 32 },
        productName: { type: "string", minLength: 1, maxLength: 32 },
        port: { type: "integer", minimum: 1, maximum: 65535 },
        uiPort: { type: "integer", minimum: 1, maximum: 65535 },
        listenAddress: { type: "string", minLength: 1 },
      },
    },
    devices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "endpointId", "name", "type", "attributes"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 64 },
          endpointId: { type: "integer", minimum: 2, maximum: 65534, nullable: true },
          name: { type: "string", minLength: 1, maxLength: 32 },
          room: { type: "string", maxLength: 32, nullable: true },
          type: { type: "string", enum: [...matterDeviceTypes] },
          attributes: {
            type: "object",
            required: [],
            additionalProperties: {
              type: "object",
              additionalProperties: false,
              required: ["stateTopic", "valueType"],
              properties: {
                stateTopic: { type: "string", minLength: 1 },
                commandTopic: { type: "string", nullable: true },
                valueType: { type: "string", enum: ["boolean", "number", "enum", "rgb"] },
                converter: {
                  type: "object",
                  nullable: true,
                  additionalProperties: false,
                  required: [],
                  properties: {
                    invert: { type: "boolean", nullable: true },
                    scale: { type: "number", nullable: true },
                    offset: { type: "number", nullable: true },
                    min: { type: "number", nullable: true },
                    max: { type: "number", nullable: true },
                    unit: { type: "string", enum: ["raw", "celsius", "percent", "kelvin", "mired"], nullable: true },
                    trueValue: { type: "string", nullable: true },
                    falseValue: { type: "string", nullable: true },
                    enum: {
                      type: "object",
                      nullable: true,
                      required: [],
                      additionalProperties: { type: ["string", "number", "boolean"] },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
