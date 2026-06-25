import type { CommandBuilder, CreateCliOptions, RunOptions } from "./types.js";

export function createCLI(_options: CreateCliOptions): CommandBuilder & {
  run: (options?: RunOptions) => Promise<number>;
  help: () => string;
} {
  throw new Error("Not implemented");
}
