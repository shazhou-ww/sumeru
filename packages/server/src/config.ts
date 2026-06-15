import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type {
	GatewayCapabilities,
	GatewayConfig,
	InstanceConfig,
} from "./types.js";

/**
 * Load and validate a `sumeru.yaml` file.
 *
 * Returns a fully-typed `InstanceConfig` on success. On any error — missing
 * file, malformed YAML, missing required fields, wrong shapes — throws an
 * `Error` whose message includes the offending field name (where applicable)
 * and the source file path.
 *
 * Unknown keys at the top level and inside individual gateway entries are
 * tolerated for forward-compatibility.
 */
export async function loadConfig(path: string): Promise<InstanceConfig> {
	const raw = await readFileSafely(path);
	const doc = parseYamlSafely(raw, path);
	return validateConfig(doc, path);
}

async function readFileSafely(path: string): Promise<string> {
	try {
		return await readFile(path, "utf-8");
	} catch (err) {
		const code =
			err instanceof Error && "code" in err
				? (err as { code: unknown }).code
				: null;
		if (code === "ENOENT") {
			throw new Error(`Config file not found: ${path}`);
		}
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`Cannot read config file ${path}: ${msg}`);
	}
}

function parseYamlSafely(raw: string, path: string): unknown {
	try {
		return parseYaml(raw);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`Invalid YAML in ${path}: ${msg}`);
	}
}

function validateConfig(doc: unknown, path: string): InstanceConfig {
	if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
		throw new Error(`Config ${path} must be a YAML mapping at the top level`);
	}
	const obj = doc as Record<string, unknown>;

	const name = obj.name;
	if (typeof name !== "string" || name.length === 0) {
		throw new Error(
			`Config ${path} is missing required field "name" (must be a non-empty string)`,
		);
	}

	const workspaceRoot = validateWorkspaceRoot(obj.workspaceRoot, path);

	const gatewaysRaw = obj.gateways;
	const gateways: Record<string, GatewayConfig> = {};
	if (gatewaysRaw !== undefined && gatewaysRaw !== null) {
		if (typeof gatewaysRaw !== "object" || Array.isArray(gatewaysRaw)) {
			throw new Error(
				`Config ${path} field "gateways" must be a mapping (got ${describeShape(
					gatewaysRaw,
				)})`,
			);
		}
		for (const [key, entry] of Object.entries(
			gatewaysRaw as Record<string, unknown>,
		)) {
			gateways[key] = validateGatewayEntry(entry, key, path);
		}
	}

	return { name, workspaceRoot, gateways };
}

/**
 * Validate the optional top-level `workspaceRoot` field.
 *
 * Absent / undefined / null → `null`. Empty string → `null` (treated as
 * "operator did not configure one"). Non-empty string → returned verbatim
 * (no path resolution at this layer). Any other type → throws with the
 * field name and source path.
 */
function validateWorkspaceRoot(raw: unknown, path: string): string | null {
	if (raw === undefined || raw === null) return null;
	if (typeof raw !== "string") {
		throw new Error(
			`Config ${path} field "workspaceRoot" must be a string (got ${describeShape(
				raw,
			)})`,
		);
	}
	if (raw.length === 0) return null;
	return raw;
}

function validateGatewayEntry(
	entry: unknown,
	key: string,
	path: string,
): GatewayConfig {
	if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
		throw new Error(
			`Config ${path} gateway "${key}" must be a mapping (got ${describeShape(
				entry,
			)})`,
		);
	}
	const obj = entry as Record<string, unknown>;

	const adapter = obj.adapter;
	if (typeof adapter !== "string" || adapter.length === 0) {
		throw new Error(
			`Config ${path} gateway "${key}" is missing required field "adapter" (must be a non-empty string)`,
		);
	}

	const capsRaw = obj.capabilities;
	if (capsRaw === undefined || capsRaw === null) {
		throw new Error(
			`Config ${path} gateway "${key}" is missing required field "capabilities"`,
		);
	}
	const capabilities = validateCapabilities(capsRaw, key, path);

	return { adapter, capabilities };
}

function validateCapabilities(
	raw: unknown,
	key: string,
	path: string,
): GatewayCapabilities {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new Error(
			`Config ${path} gateway "${key}" field "capabilities" must be a mapping (got ${describeShape(
				raw,
			)})`,
		);
	}
	const obj = raw as Record<string, unknown>;

	const resume = obj.resume;
	if (typeof resume !== "boolean") {
		throw new Error(
			`Config ${path} gateway "${key}" field "capabilities.resume" must be a boolean`,
		);
	}
	const streaming = obj.streaming;
	if (typeof streaming !== "boolean") {
		throw new Error(
			`Config ${path} gateway "${key}" field "capabilities.streaming" must be a boolean`,
		);
	}

	return { resume, streaming };
}

function describeShape(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}
