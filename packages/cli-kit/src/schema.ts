import type { z } from "zod";

export function defaultReturnSchemaName(
  _cliName: string,
  _commandPath: readonly string[],
): string {
  throw new Error("Not implemented");
}

export function defaultYieldSchemaName(
  _cliName: string,
  _commandPath: readonly string[],
): string {
  throw new Error("Not implemented");
}

export function validateWithSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(value);
}
