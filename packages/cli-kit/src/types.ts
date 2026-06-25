import type { z } from "zod";

export type FlagType = "string" | "number" | "boolean";
export type OutputFormat = "yaml" | "json" | "text" | "html";

export interface FlagDefinition {
  type: FlagType;
  default?: string | number | boolean;
}

export interface ParsedFlags extends Record<string, unknown> {
  format: OutputFormat;
  compact: boolean;
  quiet: boolean;
  render?: boolean;
}

export interface CliContext {
  command: string;
  error: (message: string, code?: string) => never;
  log: {
    debug: (tag: string, msg: string) => void;
    info: (tag: string, msg: string) => void;
    warn: (tag: string, msg: string) => void;
  };
}

export type CommandAction = (
  args: Record<string, string>,
  flags: ParsedFlags,
  ctx: CliContext,
) => Promise<unknown> | AsyncGenerator<unknown, unknown, unknown>;

export interface CommandBuilder {
  arg(name: string): CommandBuilder;
  flag(name: string, definition: FlagDefinition): CommandBuilder;
  yields(
    schema: z.ZodType<unknown>,
    template: string,
    options?: { name?: string },
  ): CommandBuilder;
  returns(
    schema: z.ZodType<unknown>,
    template: string,
    options?: { name?: string },
  ): CommandBuilder;
  command(name: string): CommandBuilder;
  action(fn: CommandAction): CommandBuilder;
}

export interface CliPlugin {
  name: string;
  enableRenderFlag?: boolean;
  openStore?: () => unknown;
}

export interface CreateCliOptions {
  name: string;
  version: string;
  plugins?: CliPlugin[];
  homeDir?: string;
}

export interface RunOptions {
  argv?: string[];
  stdout?: { write: (text: string) => void };
  stderr?: { write: (text: string) => void };
}

export interface SchemaBinding {
  schema: z.ZodType<unknown>;
  template: string;
  name?: string;
}
