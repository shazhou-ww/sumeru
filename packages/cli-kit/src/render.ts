import type { CliPlugin } from "./types.js";

export function renderTemplate(template: string, value: unknown): string {
  return template;
}

export function ocasRenderPlugin(openStore: () => unknown): CliPlugin {
  return {
    name: "ocas-render",
    enableRenderFlag: true,
    openStore,
  };
}
