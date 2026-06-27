/**
 * Foundation toolchain baseline (RFC #99 P0, issue #102).
 *
 * The packaged Dockerfile (`packages/server/templates/docker/Dockerfile`,
 * shipped inside `@sumeru/server`) is upgraded from a thin base to a full
 * workshop foundation: build-essential + uv (Python multi-version, default
 * 3.12) + nvm (Node multi-version, default 24 LTS). All toolchain installs run
 * at BUILD TIME as root; the container still RUNS as the non-root uid 10001.
 *
 * Two tiers, mirroring `docker-templates.test.ts`:
 *   1. Non-gated CONTENT assertions — grep the shipped Dockerfile text. These
 *      run everywhere (CI included) with zero Docker side effects.
 *   2. SUMERU_DOCKER_INTEGRATION-gated BUILD/RUN assertions — drive a real
 *      `docker build` + `docker run` on a Docker host. With the env var unset
 *      the whole block is `describe.skipIf`-skipped (never failed); no `docker`
 *      child is spawned at module load.
 *
 * Behavior contract: specs/deploy/docker-toolchain-baseline.md.
 * Project rules: `type` over `interface`, named exports only, no default
 * export, no optional `?:`, `.js` ESM import extensions, kebab-case filename.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DOCKER = process.env.SUMERU_DOCKER_INTEGRATION === "1";

/** Cold `docker build` budget (toolchain layers download apt + uv + node). */
const COLD_BUILD_MS = 600_000;
const RUN_MS = 120_000;

function templatesDir(): string {
	return fileURLToPath(new URL("../templates/docker/", import.meta.url));
}

function readDockerfile(): string {
	return readFileSync(`${templatesDir()}Dockerfile`, "utf-8");
}

// ─── Tier 1: non-gated Dockerfile content assertions ─────────────────────────

describe("Dockerfile — foundation toolchain (build-time root)", () => {
	const dockerfile = readDockerfile();

	it("installs the build-essential compile toolchain", () => {
		expect(dockerfile).toMatch(/apt-get install[^\n]*build-essential/);
	});

	it("copies the uv / uvx binaries from the published uv image onto PATH", () => {
		expect(dockerfile).toMatch(
			/COPY --from=ghcr\.io\/astral-sh\/uv:[^\s]+ \/uv \/uvx \/usr\/local\/bin\//,
		);
	});

	it("installs the default Python 3.12 via uv", () => {
		expect(dockerfile).toMatch(/uv python install 3\.12/);
	});

	it("puts python/python3 on PATH (resolvable by non-login spawn, not only login shells)", () => {
		// A symlink (or equivalent) under /usr/local/bin so a bare `python`
		// resolves for a non-interactive `spawn`, not just a sourced shell.
		expect(dockerfile).toMatch(/\/usr\/local\/bin\/python3?\b/);
	});

	it("installs nvm into the SHARED /usr/local/nvm (not a per-user ~/.nvm)", () => {
		expect(dockerfile).toMatch(/ENV NVM_DIR=\/usr\/local\/nvm/);
		expect(dockerfile).toMatch(/nvm-sh\/nvm\/v[0-9.]+\/install\.sh/);
	});

	it("installs Node 24 by major version and pins it as the nvm default", () => {
		// Pinned by MAJOR version, not an LTS codename — the contract is
		// "default Node major == 24" (codenames drift across nvm releases, and
		// "Jod" is in fact Node 22's codename, not 24's).
		expect(dockerfile).toMatch(/nvm install 24\b/);
		expect(dockerfile).toMatch(/nvm alias default 24\b/);
		expect(dockerfile).not.toMatch(/--lts=Jod/);
	});

	it("prepends the default Node 24 bin onto PATH via ENV (non-login spawn lands on v24)", () => {
		// The load-bearing contract (Then-2): a bare, non-login `node` — the
		// shape an adapter `spawn`s — MUST resolve to the default v24. That
		// requires the default node bin on the container's base PATH via ENV,
		// NOT only a /etc/profile.d source (which login shells alone read).
		expect(dockerfile).toMatch(/ENV PATH=\/usr\/local\/nvm\/[^\s:]+:\$PATH/);
	});

	it("hands the shared uv + nvm trees to uid 10001 (run-time non-root can add versions)", () => {
		expect(dockerfile).toMatch(/chown -R 10001:10001 \/usr\/local\/uv/);
		expect(dockerfile).toMatch(
			/chown -R 10001:10001 (["']?\$\{?NVM_DIR\}?["']?|\/usr\/local\/nvm)/,
		);
	});
});

describe("Dockerfile — BuildKit cache mounts (build-time only, zero isolation impact)", () => {
	const dockerfile = readDockerfile();

	it("declares the dockerfile:1 syntax (BuildKit enabled by default)", () => {
		expect(dockerfile).toMatch(/^# syntax=docker\/dockerfile:1/m);
	});

	it("cache-mounts the pnpm store on the @sumeru/cli install", () => {
		expect(dockerfile).toMatch(
			/RUN --mount=type=cache,target=\/root\/\.local\/share\/pnpm\/store[^\n]*\\\s*\n\s*pnpm add -g @sumeru\/cli/,
		);
	});

	it("cache-mounts the uv download cache", () => {
		expect(dockerfile).toMatch(/--mount=type=cache,target=\/root\/\.cache\/uv/);
	});

	it("cache-mounts the nvm download cache", () => {
		expect(dockerfile).toMatch(
			/--mount=type=cache,target=\/usr\/local\/nvm\/\.cache/,
		);
	});

	it("keeps caches build-time only — no VOLUME baked as a final layer", () => {
		expect(dockerfile).not.toMatch(/^VOLUME/m);
	});
});

describe("Dockerfile — additive: non-root model + self-containment unchanged", () => {
	const dockerfile = readDockerfile();

	it("still ends as the non-root sumeru user (uid 10001)", () => {
		expect(dockerfile).toMatch(/^USER (sumeru|10001)/m);
		expect(dockerfile).toMatch(/--uid 10001 --gid 10001/);
	});

	it("installs the whole toolchain BEFORE switching to the non-root USER (build-time root)", () => {
		const userIdx = dockerfile.search(/^USER /m);
		const buildEssentialIdx = dockerfile.indexOf("build-essential");
		const uvIdx = dockerfile.indexOf("uv python install");
		const nvmIdx = dockerfile.indexOf("nvm install 24");
		expect(buildEssentialIdx).toBeGreaterThan(-1);
		expect(uvIdx).toBeGreaterThan(-1);
		expect(nvmIdx).toBeGreaterThan(-1);
		expect(buildEssentialIdx).toBeLessThan(userIdx);
		expect(uvIdx).toBeLessThan(userIdx);
		expect(nvmIdx).toBeLessThan(userIdx);
	});

	it("remains self-contained — no COPY of a Sumeru source tree", () => {
		expect(dockerfile).not.toMatch(/COPY\s+(packages|src|dist)\b/);
		expect(dockerfile).not.toMatch(/COPY \. /);
	});

	it("leaves the ocas pre-create + SUMERU_OCAS_DIR model intact", () => {
		expect(dockerfile).toMatch(/chown -R sumeru:sumeru \/data\/ocas/);
		expect(dockerfile).toMatch(/ENV SUMERU_OCAS_DIR=\/data\/ocas/);
	});
});

// ─── Tier 2: SUMERU_DOCKER_INTEGRATION-gated real build / run ─────────────────

const IMAGE_TAG = "sumeru-toolchain:test";

/** Run a probe against the built image, overriding the `sumeru` entrypoint. */
function probe(entrypoint: string, args: string[]): string {
	return execFileSync(
		"docker",
		["run", "--rm", "--entrypoint", entrypoint, IMAGE_TAG, ...args],
		{ encoding: "utf-8", timeout: RUN_MS },
	);
}

describe.skipIf(!DOCKER)(
	"foundation toolchain — Docker build + run (gated)",
	() => {
		let ctx = "";

		beforeAll(() => {
			// Build from an EMPTY context (proves self-containment) using the
			// shipped Dockerfile. One build, reused across every probe below.
			ctx = mkdtempSync(join(tmpdir(), "sumeru-toolchain-ctx-"));
			const dockerfile = `${templatesDir()}Dockerfile`;
			execFileSync(
				"docker",
				["build", "-f", dockerfile, "-t", IMAGE_TAG, "."],
				{ cwd: ctx, stdio: "ignore", timeout: COLD_BUILD_MS },
			);
		}, COLD_BUILD_MS);

		afterAll(() => {
			if (ctx) rmSync(ctx, { recursive: true, force: true });
		});

		// Then-1: image builds (covered by beforeAll) + self-contained.
		it("built from an empty context (self-contained, no source COPY)", () => {
			const out = execFileSync("docker", ["image", "inspect", IMAGE_TAG], {
				encoding: "utf-8",
			});
			expect(out).toContain(IMAGE_TAG.split(":")[0]);
		});

		// Then-2: default Python 3.12 — login shell AND direct non-login exec.
		it("defaults Python to 3.12 via both a login shell and a direct non-login exec", () => {
			expect(probe("sh", ["-lc", "python --version"]).trim()).toMatch(
				/^Python 3\.12\./,
			);
			expect(probe("python", ["--version"]).trim()).toMatch(/^Python 3\.12\./);
		});

		// Then-2 (load-bearing): default Node 24 — including a bare non-login exec.
		it("defaults Node to v24 — including a bare non-login exec (the adapter spawn shape)", () => {
			expect(probe("sh", ["-lc", "node --version"]).trim()).toMatch(/^v24\./);
			// The crux: a direct, non-login `node` (no /etc/profile sourcing) MUST
			// still land on v24, else a spawned agent process gets the wrong Node.
			expect(probe("node", ["--version"]).trim()).toMatch(/^v24\./);
		});

		// Then-3: uv switches Python versions on demand (pre-built binary, fast).
		it("uv installs and runs another Python version on demand (3.11)", () => {
			const out = probe("sh", [
				"-c",
				"uv python install 3.11 && uv run -p 3.11 python --version",
			]);
			expect(out).toMatch(/3\.11\./);
		});

		// Then-4: nvm switches Node versions on demand from the shared dir.
		it("nvm installs and uses another Node version on demand (20), as non-root", () => {
			const out = probe("sh", [
				"-c",
				'. "$NVM_DIR/nvm.sh" && nvm install 20 && nvm use 20 && node -v',
			]);
			expect(out).toMatch(/v20\./);
		});

		// Then-5: native C-extensions compile under the non-root user.
		it("compiles native code as the non-root user (build-essential present)", () => {
			// Direct proof: cc compiles + links + runs a C program as uid 10001 —
			// no apt, no root.
			const cc = probe("sh", [
				"-c",
				'printf "int main(){return 0;}" > /tmp/t.c && cc /tmp/t.c -o /tmp/t && /tmp/t && echo COMPILE_OK',
			]);
			expect(cc).toMatch(/COMPILE_OK/);
			// The agent-facing payoff: a Python package with a C extension installs.
			const pip = probe("sh", [
				"-c",
				"uv pip install --system --python 3.12 cffi && python -c 'import cffi; print(cffi.__version__)'",
			]);
			expect(pip.trim().length).toBeGreaterThan(0);
		});

		// Then-6: non-root identity unchanged.
		it("still runs as the fixed non-root uid 10001", () => {
			expect(probe("id", ["-u"]).trim()).toBe("10001");
		});

		// Then-7: server geo-layer Node stays reproducible + independent.
		it("keeps the @sumeru/cli global install intact (server geo-layer untouched)", () => {
			const tools = probe("sh", [
				"-c",
				"command -v git && command -v node && command -v sumeru",
			]);
			expect(tools.split("\n").filter((l) => l.length > 0).length).toBe(3);
			// The pnpm-global @sumeru/cli is still resolvable with a concrete
			// version in the content-addressed store (same probe shape as
			// docker-mode.test).
			const pkg = probe("sh", [
				"-c",
				'cat "$(find "$PNPM_HOME" -path "*@sumeru/cli/package.json" | head -1)"',
			]);
			const meta = JSON.parse(pkg) as { name: string; version: string };
			expect(meta.name).toBe("@sumeru/cli");
			expect(meta.version.length).toBeGreaterThan(0);
		});
	},
);
