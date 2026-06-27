/**
 * Gated Docker integration suite (issue #86, phase 3).
 *
 * Drives the REAL Docker backend end-to-end on a host with Docker installed,
 * locking the eight behaviors enumerated in
 * `specs/integration/docker-mode-integration.md` (Then-0..Then-9):
 *
 *   build/self-contained · start+health · SSE round-trip · ocas persistence
 *   across `down` · multi-unit isolation · export shape · non-fatal gateway
 *   degradation · no-Docker downgrade.
 *
 * THE GATE (Then-0, load-bearing): the entire suite is wrapped by
 * `describe.skipIf(!process.env.SUMERU_DOCKER_INTEGRATION)`. With the env var
 * UNSET, vitest reports the suite as *skipped* (never *failed*), imports the
 * module with ZERO Docker side effects, and spawns no `docker` child. CI has no
 * Docker, so this gate is the contract that keeps CI green (issue Non-goal: no
 * CI execution of the Docker suite).
 *
 * Determinism: the SSE / persistence / export cases use a fake `hermes`
 * bind-mounted into the container's `/workspace` (no LLM, no creds, no network).
 *
 * Project rules: `type` over `interface`, named exports only, no default
 * export, no optional `?:`, `.js` ESM import extensions, kebab-case filename.
 */

import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	alphaConfig,
	betaConfig,
	type CleanupTarget,
	canonicalTarEntries,
	compose,
	composeDown,
	countSseEvents,
	degradedConfig,
	docker,
	gunzip,
	hasVolume,
	httpGet,
	httpPost,
	httpPostBytes,
	pollHealthy,
	postSse,
	runCli,
	tarEntryNames,
	writeConfig,
	writeFakeHermes,
} from "./helpers/docker.js";

const GATED = Boolean(process.env.SUMERU_DOCKER_INTEGRATION);

/** Cold `--build` budget vs. an already-built image warm start. */
const COLD_BUILD_MS = 180_000;
const WARM_START_MS = 30_000;

/** A built image tag the suite (re)builds once and reuses across cases. */
const IMAGE_TAG = "sumeru:phase3-it";

/** Per-case temp dirs to remove after each test (best-effort). */
const tmpDirs: string[] = [];
/** Per-case compose projects to tear down (`down -v`) after each test. */
const cleanups: CleanupTarget[] = [];

function unitDir(prefix: string): string {
	const d = mkdtempSync(join(tmpdir(), prefix));
	tmpDirs.push(d);
	return d;
}

function track(project: string, cwd: string): CleanupTarget {
	const t = { project, cwd };
	cleanups.push(t);
	return t;
}

/**
 * A per-case UNIQUE compose project name (`<tag>-<seq>-<rand>`).
 *
 * Sharing one fixed project (e.g. always `alpha`) across serially-run cases
 * lets a not-fully-torn-down container from the previous case get *adopted* by
 * the next `compose up` — same project ⇒ compose reuses the running container
 * instead of recreating it — so a fresh case can attach to a stale instance
 * carrying none of its sessions, surfacing as a 404 on export. A unique project
 * per case makes every `up` build its own container + named volume and every
 * `down -v` reclaim exactly its own, eliminating cross-case bleed. The volume
 * name follows compose's `<project>_<volume>` rule as `<project>_sumeru-ocas`.
 * (The instance's own identity — `GET /` `value.name` — comes from the config
 * `name:` field, which is independent of the compose project.)
 */
let projectSeq = 0;
function uniqueProject(tag: string): string {
	return `${tag}-${projectSeq++}-${randomBytes(3).toString("hex")}`;
}

/**
 * Stand a docker unit up from a freshly-written config: materialize assets via
 * `--emit-assets`, then `sumeru start -c <config>` (docker dispatch), then poll
 * health. Returns the unit dir + config path. The caller has already tracked
 * the project for teardown.
 */
async function startUnit(
	configYaml: string,
	port: number,
	project: string,
	dirPrefix: string,
	timeoutMs: number,
): Promise<{ dir: string; configPath: string }> {
	const dir = unitDir(dirPrefix);
	const configPath = writeConfig(dir, configYaml);
	const pidPath = join(unitDir("sumeru-pid-"), "sumeru.pid");
	const res = await runCli(["start", "-c", configPath], {
		SUMERU_PID_FILE: pidPath,
	});
	// `up -d` is detached; the launcher exits 0 once compose returns.
	expect(res.code, `sumeru start failed:\n${res.stderr}`).toBe(0);
	await pollHealthy(port, timeoutMs, async () => {
		const logs = await compose(project, ["logs", "--no-color"], dir);
		return logs.stdout + logs.stderr;
	});
	return { dir, configPath };
}

afterEach(async () => {
	while (cleanups.length > 0) {
		const t = cleanups.pop();
		if (t !== undefined) await composeDown(t, true);
	}
	while (tmpDirs.length > 0) {
		const d = tmpDirs.pop();
		if (d !== undefined) rmSync(d, { recursive: true, force: true });
	}
});

/** Per-case wall-clock budget: real `compose up` + health poll + teardown. */
const CASE_TIMEOUT_MS = 120_000;

describe.skipIf(!GATED)(
	"docker mode integration (gated)",
	{ timeout: CASE_TIMEOUT_MS },
	() => {
		// One shared image build so the per-case warm starts stay within budget.
		beforeAll(async () => {
			const dir = mkdtempSync(join(tmpdir(), "sumeru-img-"));
			try {
				// Emit the three templates next to a throwaway config, then build
				// the image once from that context (empty-ish: only the assets).
				const ws = join(dir, "ws");
				const cfg = writeConfig(dir, alphaConfig(ws));
				const emit = await runCli(["start", "-c", cfg, "--emit-assets"], {
					SUMERU_PID_FILE: join(dir, "pid"),
				});
				expect(emit.code, `--emit-assets failed:\n${emit.stderr}`).toBe(0);
				const build = await docker(["build", "-t", IMAGE_TAG, "."], dir);
				expect(build.code, `docker build failed:\n${build.stderr}`).toBe(0);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}, COLD_BUILD_MS);

		// ─── Then-1: image builds + self-contained ─────────────
		it("builds a self-contained image (node 24 default, global sumeru, no source COPY)", async () => {
			// The image sets `ENTRYPOINT ["sumeru"]`, so a bare `docker run IMAGE
			// node …` would run `sumeru node …` (the args become sumeru
			// subcommands). Probing the base image therefore overrides the
			// entrypoint with `--entrypoint <bin>`.
			// Default `node` is the nvm-managed v24 LTS (issue #102 toolchain
			// baseline): the foundation layer prepends the default Node 24 bin
			// onto the base PATH, so a bare non-login `node` resolves to v24, not
			// the node:22-slim base interpreter.
			const ver = await docker([
				"run",
				"--rm",
				"--entrypoint",
				"node",
				IMAGE_TAG,
				"--version",
			]);
			expect(ver.code).toBe(0);
			expect(ver.stdout.trim()).toMatch(/^v24\./);

			const tools = await docker([
				"run",
				"--rm",
				"--entrypoint",
				"sh",
				IMAGE_TAG,
				"-c",
				"command -v node && command -v sumeru",
			]);
			expect(tools.code).toBe(0);
			expect(tools.stdout).toContain("/sumeru");

			// Self-containment asserted on the shipped template: no source COPY.
			const tplUrl = new URL(
				"../../server/templates/docker/Dockerfile",
				import.meta.url,
			);
			const { readFileSync } = await import("node:fs");
			const { fileURLToPath } = await import("node:url");
			const dockerfile = readFileSync(fileURLToPath(tplUrl), "utf-8");
			expect(dockerfile).not.toMatch(/COPY\s+(packages|src|dist)\b/);

			// The global install came from the npm registry (via `pnpm add -g`,
			// per the Dockerfile), not a source tree. Assert on the published
			// package's metadata in the pnpm content-addressed store: locate the
			// `@sumeru/cli/package.json` (its store path embeds the resolved
			// version) and confirm it carries the real name + a concrete version.
			// (We `find` + read the file rather than shell out to a package
			// manager — sumeru ships via pnpm, so `npm ls -g` sees an empty
			// `/usr/local/lib`, and `pnpm ls -g` triggers a corepack network
			// fetch inside the container.)
			const pkg = await docker([
				"run",
				"--rm",
				"--entrypoint",
				"sh",
				IMAGE_TAG,
				"-c",
				'cat "$(find "$PNPM_HOME" -path "*@sumeru/cli/package.json" | head -1)"',
			]);
			expect(pkg.code).toBe(0);
			expect(pkg.stdout).toMatch(/"name":\s*"@sumeru\/cli"/);
			expect(pkg.stdout).toMatch(/"version":\s*"\d+\.\d+\.\d+/);
		});

		// ─── Then-2: a docker unit is a standard Sumeru endpoint ─
		it("starts a unit reachable on its host port with the instance envelope", async () => {
			const ws = unitDir("sumeru-ws-alpha-");
			writeFakeHermes(ws);
			const project = uniqueProject("alpha");
			track(project, "");
			const { dir } = await startUnit(
				alphaConfig(ws, project),
				7901,
				project,
				"sumeru-alpha-",
				WARM_START_MS,
			);
			cleanups[cleanups.length - 1].cwd = dir;

			const root = await httpGet("http://127.0.0.1:7901/");
			expect(root.status).toBe(200);
			const env = JSON.parse(root.body) as {
				type: string;
				value: { name: string; version: string; gateways: string[] };
			};
			expect(env.type).toBe("@sumeru/instance");
			expect(env.value.name).toBe(project);
			expect(env.value.gateways).toContain("hermes");

			const logs = await compose(project, ["logs", "--no-color"], dir);
			expect(logs.stdout + logs.stderr).toMatch(/ocas store: \/data\/ocas/);
		});

		// ─── Then-3: SSE round-trip emits turn + done ──────────
		it("runs an SSE round-trip producing at least one turn and one done", async () => {
			const ws = unitDir("sumeru-ws-sse-");
			writeFakeHermes(ws);
			const t = track(uniqueProject("alpha"), "");
			const { dir } = await startUnit(
				alphaConfig(ws, t.project),
				7901,
				t.project,
				"sumeru-sse-",
				WARM_START_MS,
			);
			t.cwd = dir;

			const created = await httpPost(
				"http://127.0.0.1:7901/gateways/hermes/sessions",
				{ config: {} },
			);
			expect(created.status).toBe(201);
			const sid = (JSON.parse(created.body) as { value: { id: string } }).value
				.id;
			expect(sid).toMatch(/^ses_[0-9A-HJKMNP-TV-Z]{26}$/);

			const stream = await postSse(
				`http://127.0.0.1:7901/gateways/hermes/sessions/${sid}/messages`,
				"ping",
			);
			expect(stream.headers["content-type"]).toMatch(/text\/event-stream/);
			expect(stream.headers["x-accel-buffering"]).toBe("no");
			expect(countSseEvents(stream.body, "turn")).toBeGreaterThanOrEqual(1);
			expect(countSseEvents(stream.body, "done")).toBe(1);
		});

		// ─── Then-4: ocas persists across `down` (no -v); -v clears ─
		it("persists ocas across down (no -v) and only clears it with -v", async () => {
			const ws = unitDir("sumeru-ws-persist-");
			writeFakeHermes(ws);
			const t = track(uniqueProject("alpha"), "");
			const volume = `${t.project}_sumeru-ocas`;
			const first = await startUnit(
				alphaConfig(ws, t.project),
				7901,
				t.project,
				"sumeru-persist-",
				WARM_START_MS,
			);
			t.cwd = first.dir;

			// Seed a recording: create + send.
			const created = await httpPost(
				"http://127.0.0.1:7901/gateways/hermes/sessions",
				{ config: {} },
			);
			const sid = (JSON.parse(created.body) as { value: { id: string } }).value
				.id;
			await postSse(
				`http://127.0.0.1:7901/gateways/hermes/sessions/${sid}/messages`,
				"remember-me",
			);
			const export1 = await httpPostBytes(
				`http://127.0.0.1:7901/gateways/hermes/sessions/${sid}/export`,
			);
			expect(export1.status).toBe(200);

			// down WITHOUT -v — the named volume must survive.
			await compose(t.project, ["down"], first.dir);
			expect(await hasVolume(volume)).toBe(true);

			// Restart from the same config; the old session rehydrates.
			const second = await startUnit(
				alphaConfig(ws, t.project),
				7901,
				t.project,
				"sumeru-persist2-",
				WARM_START_MS,
			);
			t.cwd = second.dir;

			const recalled = await httpGet(
				`http://127.0.0.1:7901/gateways/hermes/sessions/${sid}`,
			);
			expect(recalled.status).toBe(200);
			expect(
				(JSON.parse(recalled.body) as { value: { id: string } }).value.id,
			).toBe(sid);

			// Semantically-identical export after restart: the CAS closure
			// (`cas/<hash>.bin` blobs + `vars.jsonl` / `tags.jsonl`) round-trips
			// the volume byte-for-byte. We compare the *untarred entries*, NOT the
			// raw tar bytes — `@ocas/core`'s `packTar` stamps each header with a
			// live `mtime` (Date.now()), so the tar envelope differs run-to-run
			// even when the recorded data is identical. That tar-level determinism
			// is `@ocas/core`'s own contract (tracked + guarded by its unit tests,
			// ocas#219); the persistence contract THIS suite owns is "the
			// recorded data survives a restart", which lives in the entries.
			const export2 = await httpPostBytes(
				`http://127.0.0.1:7901/gateways/hermes/sessions/${sid}/export`,
			);
			expect(export2.status).toBe(200);
			expect(canonicalTarEntries(gunzip(export2.bytes))).toBe(
				canonicalTarEntries(gunzip(export1.bytes)),
			);

			// Only down -v clears the volume.
			await compose(t.project, ["down", "-v"], second.dir);
			expect(await hasVolume(volume)).toBe(false);
		});

		// ─── Then-5: multi-unit isolation (volume + port + session) ─
		it("isolates two units by volume, port, and session", async () => {
			const wsA = unitDir("sumeru-ws-iso-a-");
			const wsB = unitDir("sumeru-ws-iso-b-");
			writeFakeHermes(wsA);
			writeFakeHermes(wsB);
			const ta = track(uniqueProject("alpha"), "");
			const tb = track(uniqueProject("beta"), "");
			const volA = `${ta.project}_sumeru-ocas`;
			const volB = `${tb.project}_sumeru-ocas`;
			const a = await startUnit(
				alphaConfig(wsA, ta.project),
				7901,
				ta.project,
				"sumeru-iso-a-",
				WARM_START_MS,
			);
			ta.cwd = a.dir;
			const b = await startUnit(
				betaConfig(wsB, tb.project),
				7902,
				tb.project,
				"sumeru-iso-b-",
				WARM_START_MS,
			);
			tb.cwd = b.dir;

			// Two project-prefixed named volumes.
			expect(await hasVolume(volA)).toBe(true);
			expect(await hasVolume(volB)).toBe(true);

			// Each instance reports its own identity.
			const rootA = await httpGet("http://127.0.0.1:7901/");
			const rootB = await httpGet("http://127.0.0.1:7902/");
			expect(
				(JSON.parse(rootA.body) as { value: { name: string } }).value.name,
			).toBe(ta.project);
			expect(
				(JSON.parse(rootB.body) as { value: { name: string } }).value.name,
			).toBe(tb.project);

			// A session on alpha is invisible to beta.
			const created = await httpPost(
				"http://127.0.0.1:7901/gateways/hermes/sessions",
				{ config: {} },
			);
			const sid = (JSON.parse(created.body) as { value: { id: string } }).value
				.id;
			const onBeta = await httpGet(
				`http://127.0.0.1:7902/gateways/hermes/sessions/${sid}`,
			);
			expect(onBeta.status).toBe(404);
		});

		// ─── Then-6: export is deterministic with the documented layout ─
		it("exports a gzip tar with the documented cas/ layout", async () => {
			const ws = unitDir("sumeru-ws-export-");
			writeFakeHermes(ws);
			const t = track(uniqueProject("alpha"), "");
			const { dir } = await startUnit(
				alphaConfig(ws, t.project),
				7901,
				t.project,
				"sumeru-export-",
				WARM_START_MS,
			);
			t.cwd = dir;

			const created = await httpPost(
				"http://127.0.0.1:7901/gateways/hermes/sessions",
				{ config: {} },
			);
			const sid = (JSON.parse(created.body) as { value: { id: string } }).value
				.id;
			await postSse(
				`http://127.0.0.1:7901/gateways/hermes/sessions/${sid}/messages`,
				"export-me",
			);

			const exp = await httpPostBytes(
				`http://127.0.0.1:7901/gateways/hermes/sessions/${sid}/export`,
			);
			expect(exp.status).toBe(200);
			expect(exp.headers["content-type"]).toMatch(/application\/gzip/);
			expect(exp.headers["content-disposition"]).toContain(`${sid}.tar.gz`);

			const names = tarEntryNames(gunzip(exp.bytes));
			expect(names).toContain("vars.jsonl");
			expect(names).toContain("tags.jsonl");
			expect(names.some((n) => /^cas\/.+\.bin$/.test(n))).toBe(true);
		});

		// ─── Then-7: an unknown adapter degrades that gateway only ─
		// Real contract (cli-pass-gateway-config.md): `GET /gateways` status comes
		// from adapter-name registration, NOT a runtime binary probe. So a bundled
		// adapter (claude-code) stays `ready` even with no `claude` binary in the
		// image — the missing binary only bites lazily at createSession/send — while
		// an UNKNOWN adapter name (bogus) is the genuinely `unavailable` entry. Both
		// degrade gracefully: the instance boots healthy and hermes stays usable.
		it("reports an unknown adapter as unavailable without dragging the instance down", async () => {
			const ws = unitDir("sumeru-ws-degraded-");
			writeFakeHermes(ws);
			const t = track(uniqueProject("degraded"), "");
			const { dir } = await startUnit(
				degradedConfig(ws, t.project),
				7903,
				t.project,
				"sumeru-degraded-",
				WARM_START_MS,
			);
			t.cwd = dir;

			const gws = await httpGet("http://127.0.0.1:7903/gateways");
			expect(gws.status).toBe(200);
			const list = JSON.parse(gws.body) as {
				type: string;
				value: { name: string; status: string }[];
			};
			expect(list.type).toBe("@sumeru/gateway-list");
			const byName = new Map(list.value.map((g) => [g.name, g.status]));
			// Bundled adapters are `ready` purely by registration — claude-code
			// stays ready despite the image shipping no `claude` binary.
			expect(byName.get("hermes")).toBe("ready");
			expect(byName.get("claude-code")).toBe("ready");
			// An unknown adapter name is the real `unavailable` degradation.
			expect(byName.get("bogus")).toBe("unavailable");

			// The healthy gateway still serves on the same instance — one
			// unavailable gateway never drags down the others or the instance.
			const created = await httpPost(
				"http://127.0.0.1:7903/gateways/hermes/sessions",
				{ config: {} },
			);
			expect(created.status).toBe(201);
		});

		// ─── Then-8: no Docker → exit 1 with the exact one-line message ─
		it("exits 1 with the exact message when Docker is unavailable", async () => {
			const ws = unitDir("sumeru-ws-nodocker-");
			const dir = unitDir("sumeru-nodocker-");
			const cfg = writeConfig(dir, alphaConfig(ws));
			const res = await runCli(["start", "-c", cfg], {
				SUMERU_PID_FILE: join(unitDir("sumeru-pid-"), "sumeru.pid"),
				SUMERU_DOCKER_BIN: "/nonexistent/docker-bin",
			});
			expect(res.code).toBe(1);
			expect(res.stderr.trim()).toBe(
				"Docker is not available. Install Docker or set deploy.mode: local in your config.",
			);
			// No fallback, no stack trace.
			expect(res.stderr).not.toMatch(/\n\s+at /);
			expect(res.stdout).not.toMatch(/Listening on/);
		});
	},
);
