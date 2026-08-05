import { resolve } from "node:path";
import type { Adapter } from "@sumeru/core";
import { readAdapterManifest } from "./adapter-manifest.js";
import { computeHash } from "./package-hasher.js";
import type { SqliteStore } from "./sqlite-store.js";

export class AdapterInUseError extends Error {
	readonly adapterId: string;
	readonly prototypeNames: Array<string>;

	constructor(adapterId: string, prototypeNames: Array<string>) {
		super(
			`Adapter ${adapterId} is referenced by prototype(s): ${prototypeNames.join(", ")}`,
		);
		this.name = "AdapterInUseError";
		this.adapterId = adapterId;
		this.prototypeNames = prototypeNames;
	}
}

export class AdapterResolveError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AdapterResolveError";
	}
}

export type AdapterStore = {
	installAdapter(source: string): Promise<Adapter>;
	uninstallAdapter(ref: string): Promise<void>;
	getAdapter(ref: string): Promise<Adapter | null>;
	listAdapters(): Promise<Array<Adapter>>;
	resolveAdapter(ref: string): Promise<Adapter>;
};

export type AdapterStoreOptions = {
	/** Returns prototypes currently referencing each adapter id. */
	listAdapterRefsInUse: () => Array<{
		adapterId: string;
		prototypeName: string;
	}>;
};

export function createAdapterStore(
	store: SqliteStore,
	options: AdapterStoreOptions | null = null,
): AdapterStore {
	const listInUse = options?.listAdapterRefsInUse ?? (() => []);

	const adapterStore: AdapterStore = {
		async installAdapter(source) {
			const packagePath = resolve(source);
			const manifest = await readAdapterManifest(packagePath);
			const hash = await computeHash(packagePath);
			const id = `${manifest.name}:${hash}`;
			const existing = store.getAdapter(id);
			if (existing !== null) {
				return existing;
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
			return adapter;
		},

		async uninstallAdapter(ref) {
			const adapter = await adapterStore.resolveAdapter(ref);
			const inUse = listInUse().filter((r) => r.adapterId === adapter.id);
			if (inUse.length > 0) {
				throw new AdapterInUseError(
					adapter.id,
					inUse.map((r) => r.prototypeName),
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
	};

	return adapterStore;
}

function matchByPrefix(adapters: Array<Adapter>, ref: string): Array<Adapter> {
	return adapters.filter(
		(adapter) => adapter.name === ref || adapter.id.startsWith(`${ref}:`),
	);
}
