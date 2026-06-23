import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const DOCKER = process.env.SUMERU_DOCKER_INTEGRATION === "1";

function templatesDir(): string {
	const url = new URL("../templates/docker/", import.meta.url);
	return fileURLToPath(url);
}

function read(name: string): string {
	return readFileSync(`${templatesDir()}${name}`, "utf-8");
}

describe("Dockerfile — self-contained, npm-distributed, non-root", () => {
	const dockerfile = read("Dockerfile");

	it("starts FROM node:22-slim", () => {
		expect(dockerfile).toMatch(/^FROM node:22-slim/m);
	});

	it("declares ARG SUMERU_VERSION defaulting to latest", () => {
		expect(dockerfile).toMatch(/ARG SUMERU_VERSION=latest/);
	});

	it("installs @sumeru/cli from npm via pnpm add -g", () => {
		expect(dockerfile).toMatch(/pnpm add -g @sumeru\/cli@\$\{SUMERU_VERSION\}/);
	});

	it("is self-contained — no COPY of packages or source tree", () => {
		expect(dockerfile).not.toMatch(/COPY packages/);
		expect(dockerfile).not.toMatch(/COPY \. /);
		expect(dockerfile).not.toMatch(/COPY dist/);
	});

	it("pre-installs git and curl", () => {
		expect(dockerfile).toMatch(/\bgit\b/);
		expect(dockerfile).toMatch(/\bcurl\b/);
	});

	it("runs as a non-root user with fixed uid 10001", () => {
		expect(dockerfile).toMatch(/10001/);
		expect(dockerfile).toMatch(/^USER (sumeru|10001)/m);
	});

	it("EXPOSEs the container-internal port 7900", () => {
		expect(dockerfile).toMatch(/EXPOSE 7900/);
	});
});

describe("docker-compose.yaml — zero-render, compose-native interpolation", () => {
	const composeText = read("docker-compose.yaml");
	// biome-ignore lint/suspicious/noExplicitAny: opaque parsed YAML shape
	const compose = parseYaml(composeText) as any;

	it("parses as valid YAML", () => {
		expect(compose).toBeTypeOf("object");
		expect(compose.services.sumeru).toBeTypeOf("object");
	});

	it("contains no moustache / handlebars rendering markers", () => {
		expect(composeText).not.toMatch(/\{\{/);
		expect(composeText).not.toMatch(/\}\}/);
		expect(composeText).not.toMatch(/<[a-z_]+>/i);
	});

	it("maps the host port via SUMERU_PORT with a 7900 default", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: literal compose interpolation token
		const portMapping = "${SUMERU_PORT:-7900}:7900";
		expect(compose.services.sumeru.ports).toContain(portMapping);
	});

	it("can source its image from a build section or SUMERU_IMAGE", () => {
		const svc = compose.services.sumeru;
		const hasBuild = svc.build !== undefined;
		const hasImage =
			typeof svc.image === "string" && svc.image.includes("SUMERU_IMAGE");
		expect(hasBuild || hasImage).toBe(true);
	});

	it("declares exactly the three required mounts", () => {
		const volumes: string[] = compose.services.sumeru.volumes;
		// biome-ignore lint/suspicious/noTemplateCurlyInString: literal compose interpolation token
		const workspaceMount = "${WORKSPACE:-.}:/workspace";
		// biome-ignore lint/suspicious/noTemplateCurlyInString: literal compose interpolation token
		const configMount = "${SUMERU_CONFIG:-./sumeru.yaml}:/app/sumeru.yaml:ro";
		expect(volumes).toContain("sumeru-ocas:/data/ocas");
		expect(volumes).toContain(workspaceMount);
		expect(volumes).toContain(configMount);
		expect(volumes.length).toBe(3);
	});

	it("marks env_file as not required (missing credentials non-fatal)", () => {
		const envFile = compose.services.sumeru.env_file;
		expect(envFile).toEqual([{ path: "./sumeru.env", required: false }]);
	});

	it("passes SUMERU_OCAS_DIR and HOME through environment", () => {
		const env = compose.services.sumeru.environment;
		expect(env.SUMERU_OCAS_DIR).toBe("/data/ocas");
		expect(env.HOME).toBe("/home/sumeru");
	});

	it("declares the top-level named volume sumeru-ocas", () => {
		expect("sumeru-ocas" in compose.volumes).toBe(true);
	});

	it("declares a curl-based healthcheck", () => {
		const hc = compose.services.sumeru.healthcheck;
		expect(JSON.stringify(hc.test)).toMatch(/curl/);
		expect(JSON.stringify(hc.test)).toMatch(/127\.0\.0\.1:7900/);
	});
});

describe("sumeru.env.example — credential template", () => {
	const env = read("sumeru.env.example");

	it("carries the Anthropic adapter credential keys (no secrets)", () => {
		expect(env).toMatch(/^ANTHROPIC_API_KEY=/m);
		expect(env).toMatch(/^ANTHROPIC_BASE_URL=/m);
	});

	it("uses env-file format (no export, key has empty placeholder value)", () => {
		expect(env).not.toMatch(/export /);
		expect(env).toMatch(/ANTHROPIC_API_KEY=\s*$/m);
	});

	it("instructs copying to sumeru.env, chmod 600, never committing", () => {
		expect(env).toMatch(/sumeru\.env/);
		expect(env).toMatch(/chmod 600/);
		expect(env).toMatch(/[Nn]ever commit/);
	});
});

describe("packaging (npm pack)", () => {
	function serverPkgDir(): string {
		return fileURLToPath(new URL("../", import.meta.url));
	}

	it("lists all three docker templates in the package tarball", () => {
		const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
			cwd: serverPkgDir(),
			encoding: "utf-8",
		});
		const parsed = JSON.parse(out) as Array<{
			files: Array<{ path: string }>;
		}>;
		const paths = parsed[0].files.map((f) => f.path);
		expect(paths).toContain("templates/docker/Dockerfile");
		expect(paths).toContain("templates/docker/docker-compose.yaml");
		expect(paths).toContain("templates/docker/sumeru.env.example");
	});
});

describe.skipIf(!DOCKER)("Docker-gated build assertions", () => {
	const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

	it("builds the image from an empty context (no source COPY)", () => {
		const dockerfile = `${templatesDir()}Dockerfile`;
		execFileSync(
			"docker",
			["build", "-f", dockerfile, "-t", "sumeru:test", "."],
			{ cwd: repoRoot, stdio: "ignore" },
		);
		const node = execFileSync(
			"docker",
			["run", "--rm", "sumeru:test", "node", "--version"],
			{ encoding: "utf-8" },
		);
		expect(node).toMatch(/^v22\./);
	});

	it("has git, curl, and sumeru on PATH", () => {
		const out = execFileSync(
			"docker",
			[
				"run",
				"--rm",
				"sumeru:test",
				"sh",
				"-lc",
				"command -v git && command -v curl && command -v sumeru",
			],
			{ encoding: "utf-8" },
		);
		expect(out.split("\n").filter((l) => l.length > 0).length).toBe(3);
	});
});
