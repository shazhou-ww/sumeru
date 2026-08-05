import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAdapterManifest } from "../src/adapter-manifest.js";

describe("readAdapterManifest", () => {
	it("parses required and optional fields", async () => {
		const root = mkdtempSync(join(tmpdir(), "adapter-manifest-"));
		writeFileSync(
			join(root, "sumeru-adapter.yaml"),
			[
				"name: sarsapa",
				"version: 0.4.1",
				"cli: ./dist/main.js",
				"dockerfile: ./Dockerfile",
				'default_instructions: "You are helpful."',
				"default_model: gpt-4",
				"base_image: node:22-slim",
			].join("\n"),
		);

		const manifest = await readAdapterManifest(root);
		expect(manifest).toEqual({
			name: "sarsapa",
			version: "0.4.1",
			cliPath: "./dist/main.js",
			dockerfilePath: "./Dockerfile",
			defaultInstructions: "You are helpful.",
			defaultModel: "gpt-4",
			baseImage: "node:22-slim",
		});
	});

	it("accepts camelCase keys as well as snake_case", async () => {
		const root = mkdtempSync(join(tmpdir(), "adapter-manifest-"));
		writeFileSync(
			join(root, "sumeru-adapter.yaml"),
			[
				"name: demo",
				"version: 1.0.0",
				"cliPath: ./cli.js",
				"dockerfilePath: ./Custom.Dockerfile",
				"defaultInstructions: hi",
				"defaultModel: null",
				"baseImage: null",
			].join("\n"),
		);

		const manifest = await readAdapterManifest(root);
		expect(manifest.cliPath).toBe("./cli.js");
		expect(manifest.dockerfilePath).toBe("./Custom.Dockerfile");
		expect(manifest.defaultInstructions).toBe("hi");
		expect(manifest.defaultModel).toBeNull();
		expect(manifest.baseImage).toBeNull();
	});

	it("applies defaults for optional fields", async () => {
		const root = mkdtempSync(join(tmpdir(), "adapter-manifest-"));
		writeFileSync(
			join(root, "sumeru-adapter.yaml"),
			["name: demo", "version: 1.0.0", "cli: ./cli.js"].join("\n"),
		);

		const manifest = await readAdapterManifest(root);
		expect(manifest.dockerfilePath).toBe("Dockerfile");
		expect(manifest.defaultInstructions).toBe("");
		expect(manifest.defaultModel).toBeNull();
		expect(manifest.baseImage).toBeNull();
	});

	it("throws when required fields are missing", async () => {
		const root = mkdtempSync(join(tmpdir(), "adapter-manifest-"));
		writeFileSync(join(root, "sumeru-adapter.yaml"), "name: demo\n");
		await expect(readAdapterManifest(root)).rejects.toThrow(/version|cli/i);
	});

	it("throws when sumeru-adapter.yaml is missing", async () => {
		const root = mkdtempSync(join(tmpdir(), "adapter-manifest-"));
		await expect(readAdapterManifest(root)).rejects.toThrow(
			/sumeru-adapter\.yaml/,
		);
	});

	it("throws on invalid yaml", async () => {
		const root = mkdtempSync(join(tmpdir(), "adapter-manifest-"));
		writeFileSync(
			join(root, "sumeru-adapter.yaml"),
			"name: [unclosed\nversion: 1",
		);
		await expect(readAdapterManifest(root)).rejects.toThrow(/invalid/i);
	});
});
