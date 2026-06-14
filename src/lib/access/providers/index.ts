import type { AccessProvider, DeviceConfig } from "./types";
import { ControlIdProvider } from "./control-id";
import { HenryProvider } from "./henry";
import { TopDataProvider } from "./topdata";
import { MockProvider } from "./mock";

export function getProvider(device: DeviceConfig): AccessProvider {
  switch (device.manufacturer) {
    case "control_id":
      return new ControlIdProvider(device);
    case "henry":
      return new HenryProvider(device);
    case "topdata":
      return new TopDataProvider(device);
    case "mock":
    case "other":
    default:
      return new MockProvider(device);
  }
}

export type { AccessProvider, DeviceConfig } from "./types";
