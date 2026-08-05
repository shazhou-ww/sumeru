import { DatabaseSync } from "node:sqlite";
import type {
	Adapter,
	ExitSignal,
	Model,
	ModelConfig,
	Provider,
	ProviderApiType,
	SessionStatus,
	Skill,
} from "@sumeru/core";

const SCHEMA_VERSION = 10;

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
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (provider) REFERENCES providers(name) ON DELETE RESTRICT
);
`;

const MIGRATION_V2 = `
-- personas table removed in refactor
`;

const MIGRATION_V3 = `
CREATE TABLE IF NOT EXISTS skills (
  name TEXT PRIMARY KEY NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const MIGRATION_V4 = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  prototype TEXT NOT NULL,
  project TEXT,
  task TEXT,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  image TEXT,
  containerName TEXT,
  createdAt TEXT NOT NULL,
  exit TEXT
);
`;

const MIGRATION_V5 = `
DROP TABLE IF EXISTS models;
CREATE TABLE models (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  context_window INTEGER,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (provider) REFERENCES providers(name) ON DELETE RESTRICT
);
`;

const MIGRATION_V6 = `
CREATE TABLE models_v6 (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  context_window INTEGER,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (provider) REFERENCES providers(name) ON DELETE RESTRICT
);
INSERT INTO models_v6 (id, provider, model, context_window, metadata, created_at, updated_at)
  SELECT id, provider, model, context_window, metadata, created_at, updated_at FROM models;
DROP TABLE models;
ALTER TABLE models_v6 RENAME TO models;
`;

const MIGRATION_V7 = `
ALTER TABLE sessions ADD COLUMN initVersion TEXT;
`;

const MIGRATION_V8 = `
ALTER TABLE sessions ADD COLUMN originSessionId TEXT;
ALTER TABLE sessions ADD COLUMN originTurnCount INTEGER;
`;

const MIGRATION_V9 = `
CREATE TABLE IF NOT EXISTS adapters (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  hash TEXT NOT NULL,
  version TEXT NOT NULL,
  source TEXT NOT NULL,
  imageTag TEXT NOT NULL,
  cliPath TEXT NOT NULL,
  defaultInstructions TEXT NOT NULL DEFAULT '',
  defaultModel TEXT,
  installedAt TEXT NOT NULL
);
`;

const MIGRATION_V10 = `
CREATE TABLE IF NOT EXISTS prototypes (
  name TEXT PRIMARY KEY NOT NULL,
  adapter TEXT NOT NULL,
  model TEXT,
  instructions TEXT NOT NULL DEFAULT ''
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
	apiType: ProviderApiType | undefined;
	baseUrl: string | null | undefined;
	apiKey: string | null | undefined;
};

export type UpsertModelInput = {
	provider?: string;
	model?: string;
	contextWindow?: number | null;
	metadata?: Record<string, unknown> | null;
};

export type CreateSkillInput = {
	name: string;
	content: string;
};

export type UpdateSkillInput = {
	content: string;
};

export type PersistSessionInput = {
	id: string;
	prototype: string;
	project: string | null;
	task: string | null;
	model: ModelConfig;
	status: SessionStatus;
	image: string;
	containerName: string | null;
	createdAt: string;
	exit: ExitSignal | null;
	initVersion: string | null;
	originSessionId: string | null;
	originTurnCount: number | null;
};

export type PersistedSession = PersistSessionInput;

export type SqliteStore = {
	close(): void;
	createProvider(input: CreateProviderInput): Provider;
	getProvider(name: string): Provider | null;
	getProviderApiKey(name: string): string | null;
	listProviders(): Array<Provider>;
	updateProvider(name: string, input: UpdateProviderInput): Provider | null;
	deleteProvider(name: string): boolean;
	getModel(name: string): Model | null;
	listModels(provider?: string): Array<Model>;
	upsertModel(name: string, input: UpsertModelInput): Model;
	removeModel(name: string): boolean;
	createSkill(input: CreateSkillInput): Skill;
	getSkill(name: string): Skill | null;
	listSkills(): Array<Skill>;
	updateSkill(name: string, input: UpdateSkillInput): Skill | null;
	deleteSkill(name: string): boolean;
	skillExists(name: string): boolean;
	persistSession(session: PersistSessionInput): void;
	removeSession(id: string): void;
	listPersistedSessions(): Array<PersistedSession>;
	installAdapter(adapter: Adapter): void;
	uninstallAdapter(id: string): boolean;
	getAdapter(id: string): Adapter | null;
	listAdapters(): Array<Adapter>;
	transaction<T>(fn: () => T): T;
	createPrototype(input: {
		name: string;
		adapter: string;
		model: string | null;
		instructions: string;
	}): void;
	listPrototypesByAdapter(adapterId: string): Array<{
		name: string;
		adapter: string;
		model: string | null;
		instructions: string;
	}>;
	deletePrototypesByAdapter(adapterId: string): number;
	listSessionsByPrototypes(prototypeNames: Array<string>): Array<string>;
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
	metadata: string;
	created_at: string;
	updated_at: string;
};

type SkillRow = {
	name: string;
	content: string;
	created_at: string;
	updated_at: string;
};

type AdapterRow = {
	id: string;
	name: string;
	hash: string;
	version: string;
	source: string;
	imageTag: string;
	cliPath: string;
	defaultInstructions: string;
	defaultModel: string | null;
	installedAt: string;
};

type PrototypeRow = {
	name: string;
	adapter: string;
	model: string | null;
	instructions: string;
};

type SessionRow = {
	id: string;
	prototype: string;
	project: string | null;
	task: string | null;
	model: string;
	status: string;
	image: string | null;
	containerName: string | null;
	createdAt: string;
	exit: string | null;
	initVersion: string | null;
	originSessionId: string | null;
	originTurnCount: number | null;
};

export function maskApiKey(key: string | null): string | null {
	if (key === null) return null;
	if (key.length <= 8) return `${key}****`;
	return `${key.slice(0, 8)}****`;
}

export function openDatabase(dbPath: string): SqliteStore {
	const db = new DatabaseSync(dbPath);
	db.exec("PRAGMA foreign_keys = ON");
	runMigrations(db);
	return createSqliteStore(db);
}

function runMigrations(db: DatabaseSync): void {
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
		if (current < 2) {
			db.exec(MIGRATION_V2);
		}
		if (current < 3) {
			db.exec(MIGRATION_V3);
		}
		if (current < 4) {
			db.exec(MIGRATION_V4);
		}
		if (current < 5) {
			db.exec(MIGRATION_V5);
		}
		if (current < 6) {
			db.exec(MIGRATION_V6);
		}
		if (current < 7) {
			db.exec(MIGRATION_V7);
		}
		if (current < 8) {
			db.exec(MIGRATION_V8);
		}
		if (current < 9) {
			db.exec(MIGRATION_V9);
		}
		if (current < 10) {
			db.exec(MIGRATION_V10);
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

function createSqliteStore(db: DatabaseSync): SqliteStore {
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

		getProviderApiKey(name) {
			const row = db
				.prepare("SELECT api_key FROM providers WHERE name = ?")
				.get(name) as { api_key: string | null } | undefined;
			return row?.api_key ?? null;
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
			const apiType =
				input.apiType === undefined ? existing.api_type : input.apiType;
			const baseUrl =
				input.baseUrl === undefined ? existing.base_url : input.baseUrl;
			const apiKey =
				input.apiKey === undefined ? existing.api_key : input.apiKey;
			db.prepare(
				`UPDATE providers
         SET api_type = ?, base_url = ?, api_key = ?, updated_at = ?
         WHERE name = ?`,
			).run(apiType, baseUrl, apiKey, now, name);
			return rowToProvider({
				...existing,
				api_type: apiType,
				base_url: baseUrl,
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

		getModel(name) {
			const row = db.prepare("SELECT * FROM models WHERE id = ?").get(name) as
				| ModelRow
				| undefined;
			return row === undefined ? null : rowToModel(row);
		},

		listModels(provider) {
			const rows =
				provider === undefined
					? (db
							.prepare("SELECT * FROM models ORDER BY id")
							.all() as Array<ModelRow>)
					: (db
							.prepare("SELECT * FROM models WHERE provider = ? ORDER BY id")
							.all(provider) as Array<ModelRow>);
			return rows.map(rowToModel);
		},

		upsertModel(name, input) {
			const existing = db
				.prepare("SELECT * FROM models WHERE id = ?")
				.get(name) as ModelRow | undefined;
			const now = new Date().toISOString();
			if (existing === undefined) {
				if (input.provider === undefined || input.model === undefined) {
					throw new Error("provider and model are required for new model");
				}
				const contextWindow = input.contextWindow ?? null;
				const metadataJson = serializeMetadata(input.metadata ?? null);
				db.prepare(
					`INSERT INTO models
           (id, provider, model, context_window, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
				).run(
					name,
					input.provider,
					input.model,
					contextWindow,
					metadataJson,
					now,
					now,
				);
				return rowToModel({
					id: name,
					provider: input.provider,
					model: input.model,
					context_window: contextWindow,
					metadata: metadataJson,
					created_at: now,
					updated_at: now,
				});
			}
			const provider =
				input.provider === undefined ? existing.provider : input.provider;
			const model = input.model === undefined ? existing.model : input.model;
			const contextWindow =
				input.contextWindow === undefined
					? existing.context_window
					: input.contextWindow;
			const metadataJson =
				input.metadata === undefined
					? existing.metadata
					: serializeMetadata(input.metadata);
			db.prepare(
				`UPDATE models
         SET provider = ?, model = ?, context_window = ?, metadata = ?, updated_at = ?
         WHERE id = ?`,
			).run(provider, model, contextWindow, metadataJson, now, name);
			return rowToModel({
				...existing,
				provider,
				model,
				context_window: contextWindow,
				metadata: metadataJson,
				updated_at: now,
			});
		},

		removeModel(name) {
			const result = db.prepare("DELETE FROM models WHERE id = ?").run(name);
			return result.changes > 0;
		},

		createSkill(input) {
			const now = new Date().toISOString();
			db.prepare(
				`INSERT INTO skills (name, content, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
			).run(input.name, input.content, now, now);
			return rowToSkill({
				name: input.name,
				content: input.content,
				created_at: now,
				updated_at: now,
			});
		},

		getSkill(name) {
			const row = db.prepare("SELECT * FROM skills WHERE name = ?").get(name) as
				| SkillRow
				| undefined;
			return row === undefined ? null : rowToSkill(row);
		},

		listSkills() {
			const rows = db
				.prepare("SELECT * FROM skills ORDER BY name")
				.all() as Array<SkillRow>;
			return rows.map(rowToSkill);
		},

		updateSkill(name, input) {
			const existing = db
				.prepare("SELECT * FROM skills WHERE name = ?")
				.get(name) as SkillRow | undefined;
			if (existing === undefined) return null;
			const now = new Date().toISOString();
			db.prepare(
				`UPDATE skills SET content = ?, updated_at = ? WHERE name = ?`,
			).run(input.content, now, name);
			return rowToSkill({
				...existing,
				content: input.content,
				updated_at: now,
			});
		},

		deleteSkill(name) {
			const result = db.prepare("DELETE FROM skills WHERE name = ?").run(name);
			return result.changes > 0;
		},

		skillExists(name) {
			const row = db
				.prepare("SELECT 1 FROM skills WHERE name = ? LIMIT 1")
				.get(name);
			return row !== undefined;
		},

		persistSession(session) {
			db.prepare(
				`INSERT OR REPLACE INTO sessions
         (id, prototype, project, task, model, status, image, containerName, createdAt, exit, initVersion, originSessionId, originTurnCount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(
				session.id,
				session.prototype,
				session.project,
				session.task,
				serializeModelConfig(session.model),
				session.status,
				session.image,
				session.containerName,
				session.createdAt,
				session.exit === null ? null : JSON.stringify(session.exit),
				session.initVersion,
				session.originSessionId,
				session.originTurnCount,
			);
		},

		removeSession(id) {
			db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
		},

		listPersistedSessions() {
			const rows = db
				.prepare("SELECT * FROM sessions ORDER BY createdAt")
				.all() as Array<SessionRow>;
			return rows.map(rowToPersistedSession);
		},

		installAdapter(adapter) {
			db.prepare(
				`INSERT OR IGNORE INTO adapters (
          id, name, hash, version, source, imageTag, cliPath,
          defaultInstructions, defaultModel, installedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(
				adapter.id,
				adapter.name,
				adapter.hash,
				adapter.version,
				adapter.source,
				adapter.imageTag,
				adapter.cliPath,
				adapter.defaultInstructions,
				adapter.defaultModel,
				adapter.installedAt,
			);
		},

		uninstallAdapter(id) {
			const result = db.prepare("DELETE FROM adapters WHERE id = ?").run(id);
			return result.changes > 0;
		},

		getAdapter(id) {
			const row = db.prepare("SELECT * FROM adapters WHERE id = ?").get(id) as
				| AdapterRow
				| undefined;
			return row === undefined ? null : rowToAdapter(row);
		},

		listAdapters() {
			const rows = db
				.prepare("SELECT * FROM adapters ORDER BY name ASC, hash ASC")
				.all() as Array<AdapterRow>;
			return rows.map(rowToAdapter);
		},

		transaction(fn) {
			db.exec("BEGIN");
			try {
				const result = fn();
				db.exec("COMMIT");
				return result;
			} catch (err) {
				db.exec("ROLLBACK");
				throw err;
			}
		},

		createPrototype(input) {
			db.prepare(
				`INSERT INTO prototypes (name, adapter, model, instructions)
         VALUES (?, ?, ?, ?)`,
			).run(input.name, input.adapter, input.model, input.instructions);
		},

		listPrototypesByAdapter(adapterId) {
			const rows = db
				.prepare("SELECT * FROM prototypes WHERE adapter = ? ORDER BY name")
				.all(adapterId) as Array<PrototypeRow>;
			return rows;
		},

		deletePrototypesByAdapter(adapterId) {
			const result = db
				.prepare("DELETE FROM prototypes WHERE adapter = ?")
				.run(adapterId);
			return Number(result.changes);
		},

		listSessionsByPrototypes(prototypeNames) {
			if (prototypeNames.length === 0) return [];
			const placeholders = prototypeNames.map(() => "?").join(",");
			const rows = db
				.prepare(
					`SELECT id FROM sessions WHERE prototype IN (${placeholders}) ORDER BY id`,
				)
				.all(...prototypeNames) as Array<{ id: string }>;
			return rows.map((row) => row.id);
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
		name: row.id,
		provider: row.provider,
		model: row.model,
		contextWindow: row.context_window,
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

function rowToSkill(row: SkillRow): Skill {
	return {
		name: row.name,
		content: row.content,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function rowToAdapter(row: AdapterRow): Adapter {
	return {
		id: row.id,
		name: row.name,
		hash: row.hash,
		version: row.version,
		source: row.source,
		imageTag: row.imageTag,
		cliPath: row.cliPath,
		defaultInstructions: row.defaultInstructions,
		defaultModel: row.defaultModel,
		installedAt: row.installedAt,
	};
}

function serializeModelConfig(model: ModelConfig): string {
	return JSON.stringify(model);
}

function parseModelConfig(raw: string): ModelConfig {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			throw new Error("invalid_model_config");
		}
		const record = parsed as Record<string, unknown>;
		if (typeof record.name !== "string") {
			throw new Error("invalid_model_config");
		}
		return {
			provider: record.provider as ModelConfig["provider"],
			name: record.name,
			apiKey:
				typeof record.apiKey === "string" || record.apiKey === null
					? record.apiKey
					: null,
		};
	} catch {
		throw new Error("invalid_model_config");
	}
}

function parseExitSignal(raw: string | null): ExitSignal | null {
	if (raw === null || raw.length === 0) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return null;
		}
		return parsed as ExitSignal;
	} catch {
		return null;
	}
}

function rowToPersistedSession(row: SessionRow): PersistedSession {
	return {
		id: row.id,
		prototype: row.prototype,
		project: row.project,
		task: row.task,
		model: parseModelConfig(row.model),
		status: row.status as SessionStatus,
		image: row.image ?? "",
		containerName: row.containerName,
		createdAt: row.createdAt,
		exit: parseExitSignal(row.exit),
		initVersion: row.initVersion ?? null,
		originSessionId: row.originSessionId ?? null,
		originTurnCount: row.originTurnCount ?? null,
	};
}
