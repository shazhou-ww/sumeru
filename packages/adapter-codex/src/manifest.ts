import type { AdapterManifest } from "@sumeru/adapter-core";

export const manifest: AdapterManifest = {
	name: "codex",
	providerMode: "both",
	credentialEnv: "OPENAI_API_KEY",
	listModels: null,
};
