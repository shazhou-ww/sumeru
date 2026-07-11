import { execSync } from "node:child_process";
import type { AdapterManifest, BuiltinModel } from "@sumeru/adapter-core";

async function listModels(): Promise<BuiltinModel[]> {
	const output = execSync("cursor-agent --list-models", {
		encoding: "utf-8",
		timeout: 15000,
	});
	const models: BuiltinModel[] = [];
	for (const line of output.split("\n")) {
		const match = line.match(/^(\S+)\s+-\s+(.+)$/);
		if (match) {
			// biome-ignore lint/style/noNonNullAssertion: regex groups guaranteed by match
			models.push({ id: match[1]!, name: match[2]!, contextWindow: null });
		}
	}
	return models;
}

export const manifest: AdapterManifest = {
	name: "cursor-agent",
	providerMode: "builtin-only",
	credentialEnv: "CURSOR_API_KEY",
	listModels,
};
