import { createApi } from "./api.js";
import { ConfigStore } from "./configStore.js";
import { DraftManager } from "./draftManager.js";
import { BridgeEventBus } from "./eventBus.js";
import { MatterService } from "./matterService.js";
import { MqttService } from "./mqttService.js";

export async function run(): Promise<void> {
  process.env.WB_STARTED_AT = new Date().toISOString();
  const dataDirectory = process.env.WB_MATTER_DATA ?? "/data";
  const store = new ConfigStore(dataDirectory);
  const { config, registry } = await store.initialize();
  const events = new BridgeEventBus();
  const drafts = new DraftManager(config, registry);
  const mqtt = new MqttService(config.mqtt, events);
  const matter = new MatterService(mqtt, events);
  await mqtt.start();
  await matter.start(config, registry);
  const api = await createApi({ store, drafts, mqtt, matter, events });
  await api.listen({ host: config.bridge.listenAddress, port: config.bridge.uiPort });

  let closing = false;
  const close = async (signal: string) => {
    if (closing) return;
    closing = true;
    api.log.info({ signal }, "Stopping WB Matter Bridge");
    await api.close();
    await mqtt.stop();
    await matter.stop();
  };
  process.once("SIGINT", () => void close("SIGINT"));
  process.once("SIGTERM", () => void close("SIGTERM"));
}
