import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export type AdapterManifest = {
	name: string;
	version: string;
	cliPath: string;
	dockerfilePath: string;
	defaultInstructions: string;
	defaultModel: string | null;
	baseImage: string | null;
};

const MANIFEST_FILE = "sumeru-adapter.yaml";

/**
 * Read and validate `sumeru-adapter.yaml` from an adapter package directory.
 *
 * YAML keys (snake_case preferred; camelCase also accepted):
 * - required: name, version, cli / cliPath
 * - optional: dockerfile / dockerfilePath (default "Dockerfile"),
 *   default_instructions / defaultInstructions (default ""),
 *   default_model / defaultModel (default null),
 *   base_image / baseImage (default null)
 */
export async function readAdapterManifest(
	packagePath: string,
): Promise<AdapterManifest> {
	const manifestPath = join(packagePath, MANIFEST_FILE);
	let raw: string;
	try {
		raw = await readFile(manifestPath, "utf-8");
	} catch {
		throw new Error(`Missing ${MANIFEST_FILE} in ${packagePath}`);
	}

	let doc: unknown;
	try {
		doc = parseYaml(raw);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Invalid ${MANIFEST_FILE}: ${message}`);
	}

	if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
		throw new Error(`${MANIFEST_FILE} must be a YAML mapping`);
	}

	const obj = doc as Record<string, unknown>;
	const name = requireString(obj, "name");
	const version = requireString(obj, "version");
	const cliPath = requireString(obj, "cli", "cliPath");
	const dockerfilePath =
		optionalString(obj, "dockerfile", "dockerfilePath") ?? "Dockerfile";
	const defaultInstructions =
		optionalString(obj, "default_instructions", "defaultInstructions") ?? "";
	const defaultModel = optionalNullableString(
		obj,
		"default_model",
		"defaultModel",
	);
	const baseImage = optionalNullableString(obj, "base_image", "baseImage");

	return {
		name,
		version,
		cliPath,
		dockerfilePath,
		defaultInstructions,
		defaultModel,
		baseImage,
	};
}

function requireString(
	obj: Record<string, unknown>,
	...keys: Array<string>
): string {
	for (const key of keys) {
		const value = obj[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	throw new Error(`Missing required field "${keys[0]}" in ${MANIFEST_FILE}`);
}

function optionalString(
	obj: Record<string, unknown>,
	...keys: Array<string>
): string | null {
	for (const key of keys) {
		const value = obj[key];
		if (value === undefined || value === null) continue;
		if (typeof value === "string") {
			return value;
		}
		throw new Error(`Field "${key}" must be a string in ${MANIFEST_FILE}`);
	}
	return null;
}

function optionalNullableString(
	obj: Record<string, unknown>,
	...keys: Array<string>
): string | null {
	for (const key of keys) {
		const value = obj[key];
		if (value === undefined) continue;
		if (value === null) return null;
		if (typeof value === "string") {
			return value.length > 0 ? value : null;
		}
		throw new Error(
			`Field "${key}" must be a string or null in ${MANIFEST_FILE}`,
		);
	}
	return null;
}
