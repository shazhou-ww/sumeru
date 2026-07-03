import { describe, expect, it } from "vitest";
import {
	computeImagePrototypeHash,
	discoverDockerPrototypes,
	mergeDockerWithYaml,
	parseSumeruImageRef,
	pickPreferredImageTag,
	prototypeFromDockerLabels,
	snapshotImageLabels,
} from "../src/docker-prototypes.js";
import type { PrototypeInfo } from "../src/types.js";

describe("parseSumeruImageRef", () => {
	it("maps sumeru/codex:dev to prototype codex", () => {
		expect(parseSumeruImageRef("sumeru/codex", "dev")).toEqual({
			name: "codex",
			imageTag: "sumeru/codex:dev",
		});
	});

	it("ignores sumeru/base images", () => {
		expect(parseSumeruImageRef("sumeru/base", "dev")).toBeNull();
	});

	it("ignores dangling tags", () => {
		expect(parseSumeruImageRef("sumeru/codex", "<none>")).toBeNull();
	});
});

describe("pickPreferredImageTag", () => {
	it("prefers dev over latest", () => {
		expect(
			pickPreferredImageTag([
				{ tag: "latest", imageTag: "sumeru/codex:latest" },
				{ tag: "dev", imageTag: "sumeru/codex:dev" },
			]),
		).toEqual({ tag: "dev", imageTag: "sumeru/codex:dev" });
	});
});

describe("prototypeFromDockerLabels", () => {
	it("builds PrototypeInfo from docker labels", () => {
		const info = prototypeFromDockerLabels({
			name: "codex",
			imageTag: "sumeru/codex:dev",
			imageId: "sha256:abc",
			labels: {
				"sumeru.harness": "codex",
				"sumeru.model": "my-provider:my-model",
				"sumeru.persona": "worker",
			},
		});
		expect(info.name).toBe("codex");
		expect(info.composePath).toBeNull();
		expect(info.imageTag).toBe("sumeru/codex:dev");
		expect(info.prototype.adapter).toBe("codex");
		expect(info.prototype.model).toBe("my-provider:my-model");
		expect(info.prototype.persona).toBe("worker");
		expect(info.prototypeHash).toMatch(/^[a-f0-9]{64}$/);
	});

	it("falls back to prototype name when harness label is missing", () => {
		const info = prototypeFromDockerLabels({
			name: "codex",
			imageTag: "sumeru/codex:dev",
			imageId: "sha256:abc",
			labels: {},
		});
		expect(info.prototype.adapter).toBe("codex");
		expect(info.prototype.persona).toBe("default");
	});
});

describe("computeImagePrototypeHash", () => {
	it("changes when labels change", () => {
		const first = computeImagePrototypeHash("sha256:abc", {
			"sumeru.harness": "codex",
		});
		const second = computeImagePrototypeHash("sha256:abc", {
			"sumeru.harness": "hermes",
		});
		expect(first).not.toBe(second);
	});
});

describe("mergeDockerWithYaml", () => {
	it("uses docker image metadata and keeps yaml persona/model defaults", () => {
		const docker: PrototypeInfo = prototypeFromDockerLabels({
			name: "codex",
			imageTag: "sumeru/codex:dev",
			imageId: "sha256:abc",
			labels: { "sumeru.harness": "codex" },
		});
		const yaml: PrototypeInfo = {
			name: "codex",
			prototype: {
				name: "codex",
				persona: "default-persona",
				model: "test-provider:default-model",
				adapter: "codex",
				extensions: ["ext-a"],
				defaults: null,
			},
			yamlPath: "/tmp/data/prototypes/codex.yaml",
			prototypeHash: "yaml-hash",
			composePath: "/tmp/prototypes/codex/compose.yaml",
			imageTag: null,
		};
		const merged = mergeDockerWithYaml(docker, yaml);
		expect(merged.composePath).toBeNull();
		expect(merged.imageTag).toBe("sumeru/codex:dev");
		expect(merged.yamlPath).toBe(yaml.yamlPath);
		expect(merged.prototype.persona).toBe("default-persona");
		expect(merged.prototype.model).toBe("test-provider:default-model");
		expect(merged.prototype.extensions).toEqual(["ext-a"]);
	});
});

describe("snapshotImageLabels", () => {
	it("includes harness, persona, and model labels", () => {
		expect(
			snapshotImageLabels({
				name: "my-snapshot",
				persona: "default-persona",
				model: "test-provider:default-model",
				adapter: "claude-code",
				extensions: null,
				defaults: null,
			}),
		).toEqual({
			"sumeru.harness": "claude-code",
			"sumeru.persona": "default-persona",
			"sumeru.model": "test-provider:default-model",
		});
	});
});

describe("discoverDockerPrototypes", () => {
	it("lists sumeru images and inspects labels", async () => {
		const calls: Array<Array<string>> = [];
		const prototypes = await discoverDockerPrototypes({
			runCommand: async (args) => {
				calls.push(args);
				if (args.includes("images")) {
					return {
						stdout: [
							JSON.stringify({
								Repository: "sumeru/codex",
								Tag: "dev",
								ID: "sha256:codex",
							}),
							JSON.stringify({
								Repository: "sumeru/base",
								Tag: "dev",
								ID: "sha256:base",
							}),
						].join("\n"),
						stderr: "",
						exitCode: 0,
					};
				}
				return {
					stdout: JSON.stringify({
						"sumeru.harness": "codex",
						"sumeru.model": "provider:model",
					}),
					stderr: "",
					exitCode: 0,
				};
			},
		});
		expect(calls.some((args) => args.includes("images"))).toBe(true);
		expect(prototypes.has("codex")).toBe(true);
		expect(prototypes.has("base")).toBe(false);
		expect(prototypes.get("codex")?.imageTag).toBe("sumeru/codex:dev");
		expect(prototypes.get("codex")?.prototype.model).toBe("provider:model");
	});
});
