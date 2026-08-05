import { resolve } from "node:path";
import type { Adapter, Prototype } from "@sumeru/core";
import { readAdapterManifest } from "./adapter-manifest.js";
import { writePrototypeFile } from "./data-store.js";
import { buildAdapterImage } from "./image-builder.js";
import { computeHash } from "./package-hasher.js";
import type { SqliteStore } from "./sqlite-store.js";

export class AdapterInUseError extends Error {
	readonly adapterId: string;
	readonly prototypeNames: Array<string>;
	readonly sessionIds: Array<string>;

	constructor(
		adapterId: string,
		prototypeNames: Array<string>,
		sessionIds: Array<string> = [],
	) {
		const parts: Array<string> = [];
		if (prototypeNames.length > 0) {
			parts.push(`prototype(s): ${prototypeNames.join(", ")}`);
		}
		if (sessionIds.length > 0) {
			parts.push(`session(s): ${sessionIds.join(", ")}`);
		}
		super(`Adapter ${adapterId} is referenced by ${parts.join(" and ")}`);
		this.name = "AdapterInUseError";
		this.adapterId = adapterId;
		this.prototypeNames = prototypeNames;
		this.sessionIds = sessionIds;
	}
}

export class AdapterResolveError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AdapterResolveError";
	}
}

export type AdapterUsage = {
	prototypes: Array<string>;
	sessions: Array<string>;
};

export type AdapterStore = {
	installAdapter(source: string): Promise<{ adapter: Adapter; isNew: boolean }>;
	uninstallAdapter(ref: string): Promise<void>;
	getAdapter(ref: string): Promise<Adapter | null>;
	listAdapters(): Promise<Array<Adapter>>;
	resolveAdapter(ref: string): Promise<Adapter>;
	getUsage(ref: string): Promise<AdapterUsage>;
};

export type AdapterStoreOptions = {
	/** Returns prototypes currently referencing each adapter id. */
	listAdapterRefsInUse: () => Array<{
		adapterId: string;
		prototypeName: string;
	}>;
	/** Returns sessions currently referencing each adapter id (via prototype). */
	listSessionRefsInUse?: () => Array<{
		adapterId: string;
		sessionId: string;
	}>;
	/** Directory where prototype YAML files are stored. */
	prototypesDir?: string;
	/** Hook to build the Docker image for an adapter. Default: buildAdapterImage from image-builder. */
	buildImage?: (adapter: Adapter, packagePath: string) => Promise<string>;
};

export function createAdapterStore(
	store: SqliteStore,
	options: AdapterStoreOptions | null = null,
): AdapterStore {
	const listInUse = options?.listAdapterRefsInUse ?? (() => []);
	const listSessionRefsInUse = options?.listSessionRefsInUse ?? (() => []);
	const prototypesDir = options?.prototypesDir;
	const buildImage = options?.buildImage ?? buildAdapterImage;

	const adapterStore: AdapterStore = {
		async installAdapter(source) {
			const packagePath = resolve(source);
			const manifest = await readAdapterManifest(packagePath);
			const hash = await computeHash(packagePath);
			const id = `${manifest.name}:${hash}`;
			const existing = store.getAdapter(id);
			if (existing !== null) {
				return { adapter: existing, isNew: false };
			}
			const adapter: Adapter = {
				id,
				name: manifest.name,
				hash,
				version: manifest.version,
				source: packagePath,
				imageTag: `sumeru/${manifest.name}:${hash}`,
				cliPath: manifest.cliPath,
				defaultInstructions: manifest.defaultInstructions,
				defaultModel: manifest.defaultModel,
				installedAt: new Date().toISOString(),
			};
			store.installAdapter(adapter);

			// Build Docker image
			await buildImage(adapter, packagePath);

			// Create default prototype
			if (prototypesDir) {
				const defaultPrototype: Prototype = {
					name: `${adapter.name}-default`,
					adapter: adapter.id,
					image: adapter.imageTag,
					instructions: `Default prototype for ${adapter.name}`,
					model: null,
					extensions: null,
					defaults: null,
					origin: null,
				};
				await writePrototypeFile(prototypesDir, defaultPrototype);
			}

			return { adapter, isNew: true };
		},

		async uninstallAdapter(ref) {
			const adapter = await adapterStore.resolveAdapter(ref);
			const usage = await adapterStore.getUsage(ref);
			if (usage.prototypes.length > 0 || usage.sessions.length > 0) {
				throw new AdapterInUseError(
					adapter.id,
					usage.prototypes,
					usage.sessions,
				);
			}
			store.uninstallAdapter(adapter.id);
		},

		async getAdapter(ref) {
			if (ref.includes(":")) {
				return store.getAdapter(ref);
			}
			const matches = matchByPrefix(store.listAdapters(), ref);
			if (matches.length !== 1) {
				return null;
			}
			return matches[0] ?? null;
		},

		async listAdapters() {
			return store.listAdapters();
		},

		async resolveAdapter(ref) {
			if (ref.includes(":")) {
				const exact = store.getAdapter(ref);
				if (exact !== null) {
					return exact;
				}
				throw new AdapterResolveError(`Adapter not found: ${ref}`);
			}

			const matches = matchByPrefix(store.listAdapters(), ref);
			if (matches.length === 0) {
				throw new AdapterResolveError(`Adapter not found: ${ref}`);
			}
			if (matches.length > 1) {
				const ids = matches.map((a) => a.id);
				throw new AdapterResolveError(
					`Ambiguous ref: ${ref}, matches: [${ids.join(", ")}]`,
				);
			}
			const match = matches[0];
			if (match === undefined) {
				throw new AdapterResolveError(`Adapter not found: ${ref}`);
			}
			return match;
		},

		async getUsage(ref) {
			const adapter = await adapterStore.resolveAdapter(ref);
			const prototypeRefs = listInUse()
				.filter((r) => r.adapterId === adapter.id)
				.map((r) => r.prototypeName);
			const sessionRefs = listSessionRefsInUse()
				.filter((r) => r.adapterId === adapter.id)
				.map((r) => r.sessionId);
			return {
				prototypes: prototypeRefs,
				sessions: sessionRefs,
			};
		},
	};

	return adapterStore;
}

function matchByPrefix(adapters: Array<Adapter>, ref: string): Array<Adapter> {
	return adapters.filter(
		(adapter) => adapter.name === ref || adapter.id.startsWith(`${ref}:`),
	);
}
