/**
 * Sumeru ocas store wrapper — opens an `@ocas/fs` CAS-backed store, runs
 * bootstrap so the schema-of-schemas exists, and registers the two Sumeru
 * schemas. Exposes the resulting `Store` and the schema hashes.
 *
 * The wrapper validates payloads against their schema before writing.
 * `@ocas/core.Store.cas.put` is intentionally non-validating; recording paths
 * always go through {@link recordTurn} / {@link recordSessionMeta} so invalid
 * payloads are rejected before they reach disk.
 */

import { mkdirSync } from "node:fs";
import {
	bootstrap,
	type Hash,
	type JSONSchema,
	putSchema,
	SchemaValidationError,
	type Store,
} from "@ocas/core";
import { createFsStore, createSqliteVarStore } from "@ocas/fs";
import * as AjvModule from "ajv";
import { SUMERU_SESSION_META_SCHEMA, SUMERU_TURN_SCHEMA } from "./schemas.js";

// ajv CJS interop: the constructor lives on `.default` at runtime, but the
// namespace shape is what tsc's verbatimModuleSyntax surfaces.
// biome-ignore lint/suspicious/noExplicitAny: CJS interop
const Ajv = ((AjvModule as any).default ??
	AjvModule) as typeof import("ajv").default;

/**
 * Local ajv instance used for validating Sumeru recording payloads. We do not
 * reuse `@ocas/core`'s internal ajv because we need the `date-time` format
 * registered (without pulling in `ajv-formats`).
 *
 * `date-time` is registered with a permissive ISO-8601 regex matching what
 * `Date.prototype.toISOString` emits — sufficient for validating timestamps
 * the server itself produces.
 */
const ajv = new Ajv();
ajv.addFormat("ocas_ref", /^[0-9A-HJKMNP-TV-Z]{13}$/);
ajv.addFormat(
	"date-time",
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/,
);

/** Hash alias for the schema-of-schemas (assigned at bootstrap). */
export type SumeruOcas = {
	store: Store;
	turnSchemaHash: Hash;
	sessionMetaSchemaHash: Hash;
	/** Schema-of-schemas hash from `@ocas/core` bootstrap. */
	metaSchemaHash: Hash;
	/** Map: schema hash → human alias for the `/ocas/:hash` endpoint. */
	schemaAliases: Record<Hash, string>;
};

/**
 * Open or create the on-disk store at `dir`. Creates the directory if needed.
 * Bootstraps `@ocas/core` schemas and registers `@sumeru/turn` +
 * `@sumeru/session-meta`.
 *
 * Throws with a `failed to open ocas store at <dir>: <cause>` message when
 * the directory cannot be created or accessed.
 */
export function openSumeruOcas(dir: string): SumeruOcas {
	let store: Store;
	try {
		// Ensure parent + dir exist before handing off to @ocas/fs.
		mkdirSync(dir, { recursive: true });
		const cas = createFsStore(dir);
		const sqlite = createSqliteVarStore(dir, cas);
		store = { cas, var: sqlite.var, tag: sqlite.tag };
	} catch (err) {
		const cause = err instanceof Error ? err.message : String(err);
		throw new Error(`failed to open ocas store at ${dir}: ${cause}`);
	}

	let aliases: Record<string, Hash>;
	try {
		aliases = bootstrap(store);
	} catch (err) {
		const cause = err instanceof Error ? err.message : String(err);
		throw new Error(`failed to open ocas store at ${dir}: ${cause}`);
	}

	const turnSchemaHash = putSchema(store, SUMERU_TURN_SCHEMA);
	const sessionMetaSchemaHash = putSchema(store, SUMERU_SESSION_META_SCHEMA);
	const metaSchemaHash = aliases["@ocas/schema"];
	if (metaSchemaHash === undefined) {
		throw new Error(
			`failed to open ocas store at ${dir}: bootstrap did not register @ocas/schema`,
		);
	}

	const schemaAliases: Record<Hash, string> = {
		[metaSchemaHash]: "@ocas/schema",
		[turnSchemaHash]: "@sumeru/turn",
		[sessionMetaSchemaHash]: "@sumeru/session-meta",
	};

	return {
		store,
		turnSchemaHash,
		sessionMetaSchemaHash,
		metaSchemaHash,
		schemaAliases,
	};
}

/**
 * Validate `payload` against the schema identified by `schemaHash`. Throws
 * `SchemaValidationError` if invalid.
 *
 * This is needed because `@ocas/core.Store.cas.put` does not validate — it
 * just hashes and stores. We always validate before writing recording data
 * so corrupted nodes never land in the store.
 *
 * The validator is our own ajv instance (not `@ocas/core`'s internal one)
 * so we can recognise the `date-time` format without pulling in
 * `ajv-formats`.
 */
export function validatePayload(
	store: Store,
	schemaHash: Hash,
	payload: unknown,
): void {
	const schemaNode = store.cas.get(schemaHash);
	if (schemaNode === null) {
		throw new SchemaValidationError(
			`Schema ${schemaHash} is not registered in the store`,
		);
	}
	const schema = schemaNode.payload as JSONSchema;
	const valid = ajv.validate(schema, payload);
	if (!valid) {
		const detail =
			ajv.errors !== null && ajv.errors !== undefined && ajv.errors.length > 0
				? ajv.errorsText(ajv.errors)
				: "(no detail)";
		throw new SchemaValidationError(
			`Payload does not validate against schema ${schemaHash}: ${detail}`,
		);
	}
}

/**
 * Validate `payload` and put it in the store. Returns the resulting hash.
 * Wraps `store.cas.put` with a pre-write validation step.
 */
export function recordPayload(
	store: Store,
	schemaHash: Hash,
	payload: unknown,
): Hash {
	validatePayload(store, schemaHash, payload);
	return store.cas.put(schemaHash, payload);
}

/**
 * Look up a schema body. Returns `null` if `schemaHash` is not in the store.
 * Convenience wrapper kept here so handlers don't need to import @ocas/core
 * directly for trivial reads.
 */
export function getRegisteredSchema(
	store: Store,
	schemaHash: Hash,
): JSONSchema | null {
	const node = store.cas.get(schemaHash);
	if (node === null) return null;
	return node.payload as JSONSchema;
}
