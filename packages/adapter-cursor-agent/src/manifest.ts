import type { AdapterManifest } from "@sumeru/adapter-core";

export const manifest: AdapterManifest = {
	name: "cursor-agent",
	providerMode: "builtin-only",
	credentialEnv: "CURSOR_API_KEY",
	listModels: null,
};
