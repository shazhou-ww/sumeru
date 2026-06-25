import type { FlagDefinition, ParsedFlags } from "./types.js";

export interface ParseResult {
  commandPath: string[];
  positionals: string[];
  flags: ParsedFlags;
}

export function parseArgv(
  _argv: string[],
  _knownFlags: Record<string, FlagDefinition>,
  _allowRenderFlag: boolean,
): ParseResult {
  throw new Error("Not implemented");
}
