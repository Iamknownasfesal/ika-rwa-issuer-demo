import { demoConfig } from "@/demoConfig";
import { DevnetExecutor } from "./devnet";
import { MockExecutor } from "./mock";
import type { Executor } from "./types";

let instance: Executor | undefined;

export function getExecutor(): Executor {
  instance ??= demoConfig.mode === "devnet" ? new DevnetExecutor() : new MockExecutor();
  return instance;
}

export { IntentRejectedError } from "./types";
export type { Executor } from "./types";
