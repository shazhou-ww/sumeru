import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Prototype } from "@sumeru/core";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
	AdapterInUseError,
	AdapterResolveError,
	type AdapterStore,
	createAdapterStore,
} from "../src/adapter-store.js";
import { openDatabase, type SqliteStore } from "../src/sqlite-store.js";

function writeDemoPackage(): string {
	const pkg = mkdtempSync(join(tmpdir(), "adapter-src-"));
	mkdirSync(join(pkg, "src"), { recursive: true });
	writeFileSync(
		join(pkg, "sumeru-adapter.yaml"),
		["name: demo", "version: 1.2.3", "cli: ./dist/main.js"].join("\n"),
	);
	writeFileSync(join(pkg, "src", "index.ts"), "export {}");
	return pkg;
}

describe("adapter-store", () => {
	let sqlite: SqliteStore;
	let store: AdapterStore;

	afterEach(() => {
		sqlite.close();
	});

	function openStore(inUseIds: string[] = []): AdapterStore {
		sqlite = openDatabase(":memory:");
		store = createAdapterStore(sqlite, {
			listAdapterRefsInUse: () =>
				inUseIds.map((adapterId) => ({
					adapterId,
					prototypeName: `proto-for-${adapterId}`,
				})),
			// Mock: skip Docker build in tests
			buildImage: async (adapter) => adapter.imageTag,
		});
		return store;
	}

	it("installAdapter installs from a local package path", async () => {
		const s = openStore();
		const pkg = writeDemoPackage();
		const { adapter, isNew } = await s.installAdapter(pkg);
		expect(isNew).toBe(true);
		expect(adapter.id).toMatch(/^demo:[a-f0-9]{6}$/);
		expect(adapter.version).toBe("1.2.3");
		expect(adapter.imageTag).toBe(`sumeru/demo:${adapter.hash}`);
		expect(adapter.cliPath).toBe("./dist/main.js");
		expect(await s.listAdapters()).toEqual([adapter]);
	});

	it("installAdapter is idempotent for the same package", async () => {
		const s = openStore();
		const pkg = writeDemoPackage();
		const first = await s.installAdapter(pkg);
		expect(first.isNew).toBe(true);
		const second = await s.installAdapter(pkg);
		expect(second.isNew).toBe(false);
		expect(second.adapter).toEqual(first.adapter);
		expect(await s.listAdapters()).toHaveLength(1);
	});

	it("getAdapter matches exact id and unique name prefix", async () => {
		const s = openStore();
		const pkg = writeDemoPackage();
		const { adapter } = await s.installAdapter(pkg);
		expect(await s.getAdapter(adapter.id)).toEqual(adapter);
		expect(await s.getAdapter("demo")).toEqual(adapter);
		expect(await s.getAdapter("missing")).toBeNull();
	});

	it("getAdapter returns null when name prefix is ambiguous", async () => {
		const s = openStore();
		const pkg = writeDemoPackage();
		const { adapter: first } = await s.installAdapter(pkg);
		sqlite.installAdapter({
			...first,
			id: "demo:bbbbbb",
			hash: "bbbbbb",
			imageTag: "sumeru/demo:bbbbbb",
		});
		expect(await s.getAdapter("demo")).toBeNull();
	});

	it("resolveAdapter matches exact id and name prefix", async () => {
		const s = openStore();
		const pkg = writeDemoPackage();
		const { adapter } = await s.installAdapter(pkg);
		expect((await s.resolveAdapter(adapter.id)).id).toBe(adapter.id);
		expect((await s.resolveAdapter("demo")).id).toBe(adapter.id);
	});

	it("resolveAdapter throws when nothing matches", async () => {
		const s = openStore();
		await expect(s.resolveAdapter("missing")).rejects.toThrow(
			AdapterResolveError,
		);
		await expect(s.resolveAdapter("missing")).rejects.toThrow(
			"Adapter not found: missing",
		);
	});

	it("resolveAdapter throws when multiple adapters match the prefix", async () => {
		const s = openStore();
		const pkg = writeDemoPackage();
		const { adapter: first } = await s.installAdapter(pkg);
		sqlite.installAdapter({
			...first,
			id: "demo:bbbbbb",
			hash: "bbbbbb",
			imageTag: "sumeru/demo:bbbbbb",
		});
		await expect(s.resolveAdapter("demo")).rejects.toThrow(AdapterResolveError);
		await expect(s.resolveAdapter("demo")).rejects.toThrow(/Ambiguous ref/);
	});

	it("uninstallAdapter removes by name prefix", async () => {
		const s = openStore();
		const pkg = writeDemoPackage();
		await s.installAdapter(pkg);
		await s.uninstallAdapter("demo");
		expect(await s.listAdapters()).toEqual([]);
	});

	it("uninstallAdapter throws AdapterInUse when prototypes reference it", async () => {
		const s = openStore();
		const pkg = writeDemoPackage();
		const { adapter } = await s.installAdapter(pkg);
		const blocked = createAdapterStore(sqlite, {
			listAdapterRefsInUse: () => [
				{ adapterId: adapter.id, prototypeName: `proto-for-${adapter.id}` },
			],
		});
		await expect(blocked.uninstallAdapter(adapter.id)).rejects.toThrow(
			AdapterInUseError,
		);
	});

	it("uninstallAdapter throws when adapter is not found", async () => {
		const s = openStore();
		await expect(s.uninstallAdapter("missing")).rejects.toThrow(
			"Adapter not found: missing",
		);
	});

	it("installAdapter creates default prototype with -default suffix", async () => {
		const prototypesDir = mkdtempSync(join(tmpdir(), "sumeru-prototypes-"));
		sqlite = openDatabase(":memory:");
		const s = createAdapterStore(sqlite, {
			listAdapterRefsInUse: () => [],
			prototypesDir,
			// Mock: skip Docker build in tests
			buildImage: async (adapter) => adapter.imageTag,
		});
		const pkg = writeDemoPackage();
		const { adapter } = await s.installAdapter(pkg);

		// Verify default prototype was created
		const defaultProtoName = `${adapter.name}-default`;
		const protoPath = join(prototypesDir, `${defaultProtoName}.yaml`);
		let exists = true;
		try {
			await access(protoPath);
		} catch {
			exists = false;
		}
		expect(exists).toBe(true);

		// Read and verify prototype content
		const protoContent = await readFile(protoPath, "utf-8");
		const proto = parseYaml(protoContent) as Prototype;
		expect(proto.name).toBe(defaultProtoName);
		expect(proto.adapter).toBe(adapter.id);
		expect(proto.image).toBe(adapter.imageTag);
		expect(proto.instructions).toBe(`Default prototype for ${adapter.name}`);
		expect(proto.model).toBeNull();
	});
});
