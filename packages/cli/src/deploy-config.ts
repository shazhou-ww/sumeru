import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

/**
 * The optional top-level `deploy:` block of a `sumeru.yaml`, parsed CLI-side.
 *
 * `@sumeru/server`'s `loadConfig` never reads this block — it is the CLI's
 * deployment manifest. Every field is present; `T | null` marks "operator did
 * not configure one". `mode` is the only field with a non-null default
 * (`"local"`), so absence of the whole block is equivalent to local mode.
 *
 * Defaults like the `7900` port and `sumeru:latest` image are deliberately NOT
 * baked in here — absent values stay `null`. Those defaults live in the
 * compose template's `${VAR:-default}` interpolation (see docker-templates.md).
 */
export type DeployConfig = {
	mode: "docker" | "local";
	port: number | null;
	workspace: string | null;
	image: string | null;
};

const DEFAULT_DEPLOY: DeployConfig = {
	mode: "local",
	port: null,
	workspace: null,
	image: null,
};

/**
 * Load and parse the optional top-level `deploy:` block of a `sumeru.yaml`.
 *
 * Absence of the block (or `mode: local` with no other fields) yields the
 * default local unit `{ mode: "local", port: null, workspace: null, image:
 * null }`. On any structural error — non-mapping block, unsupported mode,
 * non-integer / out-of-range port — throws an `Error` whose message names the
 * offending field (`deploy.mode` / `deploy.port` / `deploy`) and the source
 * file path. Never returns `null` / `undefined`.
 */
export async function loadDeployConfig(path: string): Promise<DeployConfig> {
	const raw = await readDeployFile(path);
	const doc = parseDeployYaml(raw, path);
	if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
		throw new Error(`Config ${path} must be a YAML mapping at the top level`);
	}
	const deployRaw = (doc as Record<string, unknown>).deploy;
	if (deployRaw === undefined || deployRaw === null) {
		return { ...DEFAULT_DEPLOY };
	}
	if (typeof deployRaw !== "object" || Array.isArray(deployRaw)) {
		throw new Error(
			`Config ${path} field "deploy" must be a mapping (got ${describeShape(
				deployRaw,
			)})`,
		);
	}
	const obj = deployRaw as Record<string, unknown>;
	return {
		mode: validateMode(obj.mode, path),
		port: validatePort(obj.port, path),
		workspace: foldEmpty(
			validateString(obj.workspace, "deploy.workspace", path),
		),
		image: foldEmpty(validateString(obj.image, "deploy.image", path)),
	};
}

async function readDeployFile(path: string): Promise<string> {
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

function parseDeployYaml(raw: string, path: string): unknown {
	try {
		return parseYaml(raw);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`Invalid YAML in ${path}: ${msg}`);
	}
}

function validateMode(raw: unknown, path: string): "docker" | "local" {
	if (raw === undefined || raw === null) return "local";
	if (raw === "docker" || raw === "local") return raw;
	throw new Error(
		`Config ${path} field "deploy.mode" must be one of "docker" / "local" (got ${JSON.stringify(
			raw,
		)})`,
	);
}

function validatePort(raw: unknown, path: string): number | null {
	if (raw === undefined || raw === null) return null;
	if (typeof raw !== "number" || !Number.isInteger(raw)) {
		throw new Error(
			`Config ${path} field "deploy.port" must be a number (an integer in 1..65535; got ${describeShape(
				raw,
			)})`,
		);
	}
	if (raw < 1 || raw > 65535) {
		throw new Error(
			`Config ${path} field "deploy.port" must be an integer in 1..65535 (got ${raw})`,
		);
	}
	return raw;
}

function validateString(
	raw: unknown,
	field: string,
	path: string,
): string | null {
	if (raw === undefined || raw === null) return null;
	if (typeof raw !== "string") {
		throw new Error(
			`Config ${path} field "${field}" must be a string (got ${describeShape(
				raw,
			)})`,
		);
	}
	return raw;
}

function foldEmpty(value: string | null): string | null {
	if (value === null || value.length === 0) return null;
	return value;
}

function describeShape(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}
