import type { AdapterManifest } from "@sumeru/adapter-core";
import { listModels } from "./list-models.js";

export const manifest: AdapterManifest = {
	name: "claude-code",
	providerMode: "both",
	credentialEnv: "ANTHROPIC_API_KEY",
	listModels,
};
