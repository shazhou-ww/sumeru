import type { OutputFormat } from "./types.js";

export function envelopeToNdjson(type: string, value: unknown): string {
  return `${JSON.stringify({ type, value })}\n`;
}

export function renderFinalOutput(
  _format: OutputFormat,
  _compact: boolean,
  _type: string,
  _value: unknown,
  _template: string,
): string {
  throw new Error("Not implemented");
}
