import type { ActigBridge } from "../preload";

declare global {
  interface Window {
    actig: ActigBridge;
  }
}

export {};
