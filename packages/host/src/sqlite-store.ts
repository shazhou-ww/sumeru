import { DatabaseSync } from "node:sqlite";
import type {
	ExitSignal,
	Model,
	ModelConfig,
	Persona,
	Provider,
	ProviderApiType,
	SessionStatus,
	Skill,
} from "@sumeru/core";

const SCHEMA_VERSION = 6;

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
CREATE TABLE IF NOT EXISTS personas (
  name TEXT PRIMARY KEY NOT NULL,
  instructions TEXT NOT NULL,
  skills TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
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

export class PersonaInUseError extends Error {
	readonly personaName: string;
	readonly prototypeNames: Array<string>;

	constructor(personaName: string, prototypeNames: Array<string>) {
		super(
			`Persona ${personaName} is referenced by prototypes: ${prototypeNames.join(", ")}`,
		);
		this.name = "PersonaInUseError";
		this.personaName = personaName;
		this.prototypeNames = prototypeNames;
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

export type CreatePersonaInput = {
	name: string;
	instructions: string;
};

export type UpdatePersonaInput = {
	instructions: string | undefined;
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
	createPersona(input: CreatePersonaInput): Persona;
	getPersona(name: string): Persona | null;
	listPersonas(): Array<Persona>;
	updatePersona(name: string, input: UpdatePersonaInput): Persona | null;
	deletePersona(name: string): boolean;
	createSkill(input: CreateSkillInput): Skill;
	getSkill(name: string): Skill | null;
	listSkills(): Array<Skill>;
	updateSkill(name: string, input: UpdateSkillInput): Skill | null;
	deleteSkill(name: string): boolean;
	skillExists(name: string): boolean;
	persistSession(session: PersistSessionInput): void;
	removeSession(id: string): void;
	listPersistedSessions(): Array<PersistedSession>;
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

type PersonaRow = {
	name: string;
	instructions: string;
	created_at: string;
	updated_at: string;
};

type SkillRow = {
	name: string;
	content: string;
	created_at: string;
	updated_at: string;
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

		createPersona(input) {
			const now = new Date().toISOString();
			db.prepare(
				`INSERT INTO personas (name, instructions, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
			).run(input.name, input.instructions, now, now);
			return rowToPersona({
				name: input.name,
				instructions: input.instructions,
				created_at: now,
				updated_at: now,
			});
		},

		getPersona(name) {
			const row = db
				.prepare("SELECT * FROM personas WHERE name = ?")
				.get(name) as PersonaRow | undefined;
			return row === undefined ? null : rowToPersona(row);
		},

		listPersonas() {
			const rows = db
				.prepare("SELECT * FROM personas ORDER BY name")
				.all() as Array<PersonaRow>;
			return rows.map(rowToPersona);
		},

		updatePersona(name, input) {
			const existing = db
				.prepare("SELECT * FROM personas WHERE name = ?")
				.get(name) as PersonaRow | undefined;
			if (existing === undefined) return null;
			const now = new Date().toISOString();
			const instructions =
				input.instructions === undefined
					? existing.instructions
					: input.instructions;
			db.prepare(
				`UPDATE personas
         SET instructions = ?, updated_at = ?
         WHERE name = ?`,
			).run(instructions, now, name);
			return rowToPersona({
				...existing,
				instructions,
				updated_at: now,
			});
		},

		deletePersona(name) {
			const result = db
				.prepare("DELETE FROM personas WHERE name = ?")
				.run(name);
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
         (id, prototype, project, task, model, status, image, containerName, createdAt, exit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

function rowToPersona(row: PersonaRow): Persona {
	return {
		name: row.name,
		instructions: row.instructions,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function rowToSkill(row: SkillRow): Skill {
	return {
		name: row.name,
		content: row.content,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
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
	};
}
