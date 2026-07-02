import type { AdapterManifest } from "@sumeru/adapter-core";
import { listModels } from "./list-models.js";

export const manifest: AdapterManifest = {
	name: "codex",
	providerMode: "both",
	credentialEnv: "OPENAI_API_KEY",
	listModels,
};
