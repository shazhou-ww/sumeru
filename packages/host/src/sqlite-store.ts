import type { Model, Provider, ProviderApiType } from "@sumeru/core";
import Database from "better-sqlite3";

const SCHEMA_VERSION = 1;

const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS providers (
  name TEXT PRIMARY KEY NOT NULL,
  api_type TEXT NOT NULL,
  base_url TEXT,
  api_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  context_window INTEGER,
  tool_use INTEGER NOT NULL DEFAULT 1,
  streaming INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (provider) REFERENCES providers(name) ON DELETE RESTRICT
);
`;

export class ProviderInUseError extends Error {
	readonly providerName: string;
	readonly modelCount: number;

	constructor(providerName: string, modelCount: number) {
		super(
			`Provider ${providerName} is referenced by ${String(modelCount)} model(s)`,
		);
		this.name = "ProviderInUseError";
		this.providerName = providerName;
		this.modelCount = modelCount;
	}
}

export type CreateProviderInput = {
	name: string;
	apiType: ProviderApiType;
	baseUrl: string | null;
	apiKey: string | null;
};

export type UpdateProviderInput = {
	apiType: ProviderApiType;
	baseUrl: string | null;
	apiKey: string | null | undefined;
};

export type CreateModelInput = {
	id: string;
	provider: string;
	model: string;
	contextWindow: number | null;
	toolUse: boolean;
	streaming: boolean;
	metadata: Record<string, unknown> | null;
};

export type UpdateModelInput = {
	provider: string;
	model: string;
	contextWindow: number | null;
	toolUse: boolean;
	streaming: boolean;
	metadata: Record<string, unknown> | null;
};

export type SqliteStore = {
	close(): void;
	createProvider(input: CreateProviderInput): Provider;
	getProvider(name: string): Provider | null;
	listProviders(): Array<Provider>;
	updateProvider(name: string, input: UpdateProviderInput): Provider | null;
	deleteProvider(name: string): boolean;
	createModel(input: CreateModelInput): Model;
	getModel(id: string): Model | null;
	listModels(): Array<Model>;
	updateModel(id: string, input: UpdateModelInput): Model | null;
	deleteModel(id: string): boolean;
};

type ProviderRow = {
	name: string;
	api_type: string;
	base_url: string | null;
	api_key: string | null;
	created_at: string;
	updated_at: string;
};

type ModelRow = {
	id: string;
	provider: string;
	model: string;
	context_window: number | null;
	tool_use: number;
	streaming: number;
	metadata: string;
	created_at: string;
	updated_at: string;
};

export function maskApiKey(key: string | null): string | null {
	if (key === null) return null;
	if (key.length <= 8) return `${key}****`;
	return `${key.slice(0, 8)}****`;
}

export function openDatabase(dbPath: string): SqliteStore {
	const db = new Database(dbPath);
	db.pragma("foreign_keys = ON");
	runMigrations(db);
	return createSqliteStore(db);
}

function runMigrations(db: Database.Database): void {
	db.exec(`
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);
`);
	const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as
		| { version: number }
		| undefined;
	const current = row?.version ?? 0;
	if (current >= SCHEMA_VERSION) return;

	db.exec("BEGIN");
	try {
		if (current < 1) {
			db.exec(MIGRATION_V1);
		}
		if (row === undefined) {
			db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
				SCHEMA_VERSION,
			);
		} else {
			db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
		}
		db.exec("COMMIT");
	} catch (err) {
		db.exec("ROLLBACK");
		throw err;
	}
}

function createSqliteStore(db: Database.Database): SqliteStore {
	return {
		close() {
			db.close();
		},

		createProvider(input) {
			const now = new Date().toISOString();
			db.prepare(
				`INSERT INTO providers (name, api_type, base_url, api_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
			).run(input.name, input.apiType, input.baseUrl, input.apiKey, now, now);
			return rowToProvider({
				name: input.name,
				api_type: input.apiType,
				base_url: input.baseUrl,
				api_key: input.apiKey,
				created_at: now,
				updated_at: now,
			});
		},

		getProvider(name) {
			const row = db
				.prepare("SELECT * FROM providers WHERE name = ?")
				.get(name) as ProviderRow | undefined;
			return row === undefined ? null : rowToProvider(row);
		},

		listProviders() {
			const rows = db
				.prepare("SELECT * FROM providers ORDER BY name")
				.all() as Array<ProviderRow>;
			return rows.map(rowToProvider);
		},

		updateProvider(name, input) {
			const existing = db
				.prepare("SELECT * FROM providers WHERE name = ?")
				.get(name) as ProviderRow | undefined;
			if (existing === undefined) return null;
			const now = new Date().toISOString();
			const apiKey =
				input.apiKey === undefined ? existing.api_key : input.apiKey;
			db.prepare(
				`UPDATE providers
         SET api_type = ?, base_url = ?, api_key = ?, updated_at = ?
         WHERE name = ?`,
			).run(input.apiType, input.baseUrl, apiKey, now, name);
			return rowToProvider({
				...existing,
				api_type: input.apiType,
				base_url: input.baseUrl,
				api_key: apiKey,
				updated_at: now,
			});
		},

		deleteProvider(name) {
			const countRow = db
				.prepare("SELECT COUNT(*) AS count FROM models WHERE provider = ?")
				.get(name) as { count: number };
			if (countRow.count > 0) {
				throw new ProviderInUseError(name, countRow.count);
			}
			const result = db
				.prepare("DELETE FROM providers WHERE name = ?")
				.run(name);
			return result.changes > 0;
		},

		createModel(input) {
			const now = new Date().toISOString();
			const metadataJson = serializeMetadata(input.metadata);
			db.prepare(
				`INSERT INTO models
         (id, provider, model, context_window, tool_use, streaming, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(
				input.id,
				input.provider,
				input.model,
				input.contextWindow,
				input.toolUse ? 1 : 0,
				input.streaming ? 1 : 0,
				metadataJson,
				now,
				now,
			);
			return rowToModel({
				id: input.id,
				provider: input.provider,
				model: input.model,
				context_window: input.contextWindow,
				tool_use: input.toolUse ? 1 : 0,
				streaming: input.streaming ? 1 : 0,
				metadata: metadataJson,
				created_at: now,
				updated_at: now,
			});
		},

		getModel(id) {
			const row = db.prepare("SELECT * FROM models WHERE id = ?").get(id) as
				| ModelRow
				| undefined;
			return row === undefined ? null : rowToModel(row);
		},

		listModels() {
			const rows = db
				.prepare("SELECT * FROM models ORDER BY id")
				.all() as Array<ModelRow>;
			return rows.map(rowToModel);
		},

		updateModel(id, input) {
			const existing = db
				.prepare("SELECT * FROM models WHERE id = ?")
				.get(id) as ModelRow | undefined;
			if (existing === undefined) return null;
			const now = new Date().toISOString();
			const metadataJson = serializeMetadata(input.metadata);
			db.prepare(
				`UPDATE models
         SET provider = ?, model = ?, context_window = ?, tool_use = ?, streaming = ?, metadata = ?, updated_at = ?
         WHERE id = ?`,
			).run(
				input.provider,
				input.model,
				input.contextWindow,
				input.toolUse ? 1 : 0,
				input.streaming ? 1 : 0,
				metadataJson,
				now,
				id,
			);
			return rowToModel({
				...existing,
				provider: input.provider,
				model: input.model,
				context_window: input.contextWindow,
				tool_use: input.toolUse ? 1 : 0,
				streaming: input.streaming ? 1 : 0,
				metadata: metadataJson,
				updated_at: now,
			});
		},

		deleteModel(id) {
			const result = db.prepare("DELETE FROM models WHERE id = ?").run(id);
			return result.changes > 0;
		},
	};
}

function rowToProvider(row: ProviderRow): Provider {
	return {
		name: row.name,
		apiType: row.api_type as ProviderApiType,
		baseUrl: row.base_url,
		apiKey: maskApiKey(row.api_key),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function rowToModel(row: ModelRow): Model {
	return {
		id: row.id,
		provider: row.provider,
		model: row.model,
		contextWindow: row.context_window,
		toolUse: row.tool_use !== 0,
		streaming: row.streaming !== 0,
		metadata: parseMetadata(row.metadata),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function serializeMetadata(metadata: Record<string, unknown> | null): string {
	if (metadata === null) return "{}";
	return JSON.stringify(metadata);
}

function parseMetadata(raw: string): Record<string, unknown> | null {
	if (raw.length === 0 || raw === "{}") return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (
			parsed === null ||
			typeof parsed !== "object" ||
			Array.isArray(parsed)
		) {
			return null;
		}
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}
