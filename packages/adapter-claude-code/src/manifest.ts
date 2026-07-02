import type { AdapterManifest } from "@sumeru/adapter-core";

export const manifest: AdapterManifest = {
	name: "claude-code",
	providerMode: "both",
	credentialEnv: "ANTHROPIC_API_KEY",
	listModels: null,
};
