import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { materializeDockerAssets } from "../src/index.js";

const DOCKER = process.env.SUMERU_DOCKER_INTEGRATION === "1";

const TEMPLATES = ["Dockerfile", "docker-compose.yaml", "sumeru.env.example"];

function sourceDir(): string {
	return fileURLToPath(new URL("../templates/docker/", import.meta.url));
}

function freshTmp(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-docker-assets-"));
}

const originalCwd = process.cwd();
afterEach(() => {
	process.chdir(originalCwd);
});

describe("materializeDockerAssets — files written verbatim", () => {
	it("writes all three template files into targetDir", () => {
		const tmp = freshTmp();
		materializeDockerAssets(tmp);
		for (const name of TEMPLATES) {
			expect(existsSync(join(tmp, name))).toBe(true);
		}
	});

	it("copies each file byte-for-byte (zero rendering)", () => {
		const tmp = freshTmp();
		materializeDockerAssets(tmp);
		for (const name of TEMPLATES) {
			const src = readFileSync(join(sourceDir(), name));
			const dst = readFileSync(join(tmp, name));
			expect(dst.equals(src)).toBe(true);
		}
	});

	it("returns a stable string[] of length 3, every path on disk", () => {
		const tmp = freshTmp();
		const written = materializeDockerAssets(tmp);
		expect(Array.isArray(written)).toBe(true);
		expect(written.length).toBe(3);
		for (const p of written) {
			expect(typeof p).toBe("string");
			expect(existsSync(p)).toBe(true);
		}
		// Stable order across runs.
		const again = materializeDockerAssets(freshTmp());
		expect(written.map((p) => p.split("/").pop())).toEqual(
			again.map((p) => p.split("/").pop()),
		);
	});

	it("creates targetDir recursively if it does not exist", () => {
		const tmp = freshTmp();
		const nested = join(tmp, "does", "not", "exist", "yet");
		expect(existsSync(nested)).toBe(false);
		const written = materializeDockerAssets(nested);
		expect(written.length).toBe(3);
		expect(existsSync(join(nested, "Dockerfile"))).toBe(true);
	});
});

describe("materializeDockerAssets — idempotent / re-runnable", () => {
	it("does not throw on a second call and leaves bytes identical", () => {
		const tmp = freshTmp();
		materializeDockerAssets(tmp);
		expect(() => materializeDockerAssets(tmp)).not.toThrow();
		for (const name of TEMPLATES) {
			const src = readFileSync(join(sourceDir(), name));
			const dst = readFileSync(join(tmp, name));
			expect(dst.equals(src)).toBe(true);
		}
	});
});

describe("materializeDockerAssets — install-location-relative source", () => {
	it("does not depend on process.cwd()", () => {
		const tmp = freshTmp();
		const unrelated = freshTmp();
		process.chdir(unrelated);
		const written = materializeDockerAssets(tmp);
		expect(written.length).toBe(3);
		expect(existsSync(join(tmp, "docker-compose.yaml"))).toBe(true);
	});
});

describe.skipIf(!DOCKER)(
	"materializeDockerAssets — compose validity (Docker)",
	() => {
		it("emitted compose passes `docker compose config` with tmpDir-rooted mounts", () => {
			const tmp = freshTmp();
			materializeDockerAssets(tmp);
			const out = execFileSync(
				"docker",
				["compose", "-f", join(tmp, "docker-compose.yaml"), "config"],
				{ cwd: tmp, encoding: "utf-8" },
			);
			// biome-ignore lint/suspicious/noExplicitAny: opaque parsed YAML shape
			const parsed = parseYaml(out) as any;
			const binds: Array<{ source?: string }> = (
				parsed.services.sumeru.volumes as Array<{
					type: string;
					source?: string;
				}>
			).filter((v) => v.type === "bind");
			for (const b of binds) {
				expect(b.source?.startsWith(tmp)).toBe(true);
			}
			expect("sumeru-ocas" in parsed.volumes).toBe(true);
		});
	},
);
