import { config } from "@matter/nodejs/config";

config.defaultStoragePath = process.env.WB_MATTER_STORAGE_PATH ?? "/data/runtime/matter";
config.loadConfigFile = false;
config.loadProcessArgv = false;
config.trapProcessSignals = false;

// matter.js initializes its Node.js environment while importing @matter/main.
// Configure @matter/nodejs first, then load the public Matter API.
const { Logger } = await import("@matter/main");

const requestedLevel = process.env.LOG_LEVEL ?? "info";
Logger.level = ["debug", "info", "notice", "warn", "error", "fatal"].includes(requestedLevel)
  ? requestedLevel
  : "info";
Logger.format = "plain";
