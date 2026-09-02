import { EventEmitter } from "node:events";

export interface BridgeEvent { type: string; at: string; data?: unknown }

export class BridgeEventBus extends EventEmitter {
  emitEvent(type: string, data?: unknown): void {
    this.emit("event", { type, at: new Date().toISOString(), data } satisfies BridgeEvent);
  }
}
