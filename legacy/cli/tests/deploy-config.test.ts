import { fileURLToPath } from "node:url";
import { loadConfig } from "@sumeru/server";
import { describe, expect, it } from "vitest";
import { loadDeployConfig } from "../src/deploy-config.js";

function fixturePath(name: string): string {
	const url = new URL(`./fixtures/${name}`, import.meta.url);
	return fileURLToPath(url);
}

describe("server layer ignores deploy (no regression, no leak)", () => {
	it("loadConfig resolves a deploy: block without throwing", async () => {
		const cfg = await loadConfig(fixturePath("sumeru.deploy-docker.yaml"));
		expect(cfg.name).toBe("alpha");
		expect(cfg.workspaceRoot).toBe("/workspace");
		expect(cfg.gateways.hermes).toEqual({
			adapter: "hermes",
			capabilities: { resume: true, streaming: true },
			config: null,
		});
	});

	it("InstanceConfig contains exactly name/workspaceRoot/gateways — no deploy leak", async () => {
		const cfg = await loadConfig(fixturePath("sumeru.deploy-docker.yaml"));
		expect("deploy" in cfg).toBe(false);
		expect(Object.keys(cfg).sort()).toEqual([
			"gateways",
			"name",
			"workspaceRoot",
		]);
	});
});

describe("CLI layer parses deploy", () => {
	it("parses a full docker deploy block verbatim (no ~ expansion)", async () => {
		const deploy = await loadDeployConfig(
			fixturePath("sumeru.deploy-docker.yaml"),
		);
		expect(deploy).toEqual({
			mode: "docker",
			port: 7901,
			workspace: "~/units/alpha",
			image: "sumeru:latest",
		});
	});

	it("Case 2: mode: local with others absent yields all-null tail", async () => {
		const deploy = await loadDeployConfig(
			fixturePath("sumeru.deploy-local.yaml"),
		);
		expect(deploy).toEqual({
			mode: "local",
			port: null,
			workspace: null,
			image: null,
		});
	});

	it("Case 3: absent deploy block defaults to the local unit", async () => {
		const deploy = await loadDeployConfig(
			fixturePath("sumeru.deploy-absent.yaml"),
		);
		expect(deploy).toEqual({
			mode: "local",
			port: null,
			workspace: null,
			image: null,
		});
	});

	it("never returns null/undefined — always a fully populated DeployConfig", async () => {
		const deploy = await loadDeployConfig(
			fixturePath("sumeru.deploy-absent.yaml"),
		);
		expect(deploy).not.toBeNull();
		expect(deploy).not.toBeUndefined();
		expect(typeof deploy.mode).toBe("string");
	});
});

describe("CLI layer rejects malformed deploy", () => {
	it("Case 4: unsupported mode mentions field, value, allowed set, path", async () => {
		const path = fixturePath("sumeru.deploy-bad-mode.yaml");
		await expect(loadDeployConfig(path)).rejects.toThrow(/deploy\.mode/);
		await expect(loadDeployConfig(path)).rejects.toThrow(/kubernetes/);
		await expect(loadDeployConfig(path)).rejects.toThrow(/docker/);
		await expect(loadDeployConfig(path)).rejects.toThrow(/local/);
		await expect(loadDeployConfig(path)).rejects.toThrow(path);
	});

	it("Case 5: non-number port mentions deploy.port, number, path", async () => {
		const path = fixturePath("sumeru.deploy-bad-port.yaml");
		await expect(loadDeployConfig(path)).rejects.toThrow(/deploy\.port/);
		await expect(loadDeployConfig(path)).rejects.toThrow(/number|integer/);
		await expect(loadDeployConfig(path)).rejects.toThrow(path);
	});

	it("Case 6: array deploy mentions deploy, must be a mapping, path", async () => {
		const path = fixturePath("sumeru.deploy-not-mapping.yaml");
		await expect(loadDeployConfig(path)).rejects.toThrow(/deploy/);
		await expect(loadDeployConfig(path)).rejects.toThrow(/mapping/);
		await expect(loadDeployConfig(path)).rejects.toThrow(path);
	});
});

describe("CLI layer folds empties + defers defaults", () => {
	it("folds empty-string workspace and image to null", async () => {
		const deploy = await loadDeployConfig(
			fixturePath("sumeru.deploy-empty-strings.yaml"),
		);
		expect(deploy.workspace).toBeNull();
		expect(deploy.image).toBeNull();
	});

	it("does not bake the 7900 port or sumeru:latest image default — absent stays null", async () => {
		const deploy = await loadDeployConfig(
			fixturePath("sumeru.deploy-local.yaml"),
		);
		expect(deploy.port).toBeNull();
		expect(deploy.image).toBeNull();
	});

	it("rejects an out-of-range port with the same field name", async () => {
		const path = fixturePath("sumeru.deploy-port-range.yaml");
		await expect(loadDeployConfig(path)).rejects.toThrow(/deploy\.port/);
		await expect(loadDeployConfig(path)).rejects.toThrow(path);
	});
});
