import { describe, expect, it } from "vitest";
import { BridgeEventBus } from "./eventBus.js";
import { MqttService } from "./mqttService.js";

function receive(service: MqttService, topic: string, value: string, retained = false): void {
  (service as unknown as { handleMessage(topic: string, value: string, retained: boolean): void })
    .handleMessage(topic, value, retained);
}

describe("WB MQTT catalog", () => {
  it("combines state with modern JSON meta", () => {
    const service = new MqttService({ url: "mqtt://localhost" }, new BridgeEventBus());
    const base = "/devices/wb-msw-v4_1/controls/Temperature";

    receive(service, base, "23.75", true);
    receive(service, `${base}/meta`, JSON.stringify({ type: "temperature", readonly: true, error: "r" }), true);

    expect(service.listTopics()).toEqual([expect.objectContaining({
      topic: base,
      value: "23.75",
      retained: true,
      error: "r",
      metadata: expect.objectContaining({ type: "temperature", readonly: true }),
    })]);
  });

  it("combines legacy meta fields and clears an error", () => {
    const service = new MqttService({ url: "mqtt://localhost" }, new BridgeEventBus());
    const base = "/devices/wb-mr6c_1/controls/K1";

    receive(service, `${base}/meta/readonly`, "0");
    receive(service, `${base}/meta/error`, "w");
    expect(service.listTopics()[0]).toMatchObject({ error: "w", metadata: { readonly: false, error: "w" } });

    receive(service, `${base}/meta/error`, "");
    expect(service.listTopics()[0].error).toBeUndefined();
  });

  it("does not add command topics to the discovery catalog", () => {
    const service = new MqttService({ url: "mqtt://localhost" }, new BridgeEventBus());
    receive(service, "/devices/wb-mr6c_1/controls/K1/on", "1");
    expect(service.listTopics()).toEqual([]);
  });
});
