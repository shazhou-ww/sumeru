/**
 * Test-only helpers for the gated Docker integration suite
 * (`docker-mode.test.ts`, issue #86, phase 3).
 *
 * NOTHING here touches Docker at import time — every function is inert until
 * called from inside a gated test body, preserving the Then-0 contract (a
 * Docker-less CI worker can import the suite without spawning any process).
 *
 * The module bundles:
 *   - the BUILT-CLI runner (`runCli`) driving `packages/cli/dist/cli.js`,
 *   - thin `docker` / `docker compose` wrappers + a tolerant teardown,
 *   - a bounded `GET /` health poll,
 *   - the deterministic fake-`hermes` writer (no LLM / no creds / no network),
 *   - HTTP + SSE round-trip helpers (Node built-in `fetch`),
 *   - tar/gzip export decode primitives (`node:zlib` + a minimal ustar lister;
 *     no new top-level dependency, per the spec Non-goals),
 *   - the canonical alpha / beta / degraded config fixtures.
 *
 * Project rules: `type` over `interface`, named exports only, no default
 * export, no optional `?:` properties, `.js` ESM import extensions.
 */

import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

/** Absolute path to the built CLI entry (`packages/cli/dist/cli.js`). */
export const CLI_PATH = fileURLToPath(
	new URL("../../dist/cli.js", import.meta.url),
);

/** The docker binary used by the helpers — real daemon for gated cases. */
const DOCKER_BIN = "docker";

/** Result of a spawned child process (CLI or docker). */
export type RunResult = {
	code: number | null;
	stdout: string;
	stderr: string;
};

/** A decoded HTTP response: status + lower-cased headers + text body. */
export type HttpResponse = {
	status: number;
	headers: Record<string, string>;
	body: string;
};

/** A unit to tear down in `afterEach` (compose project + its dir). */
export type CleanupTarget = {
	project: string;
	cwd: string;
};

// ─── Process runners ─────────────────────────────────────

/**
 * Spawn the built CLI as a child. `SUMERU_PID_FILE` is the caller's job to set
 * (to a temp path) so docker-mode runs never write a real pid file. The
 * production shebang's `--disable-warning=ExperimentalWarning` is reproduced so
 * stderr carries only the CLI's own lines (Then-8 pins it to exactly one).
 */
export function runCli(
	args: string[],
	env: NodeJS.ProcessEnv,
): Promise<RunResult> {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [CLI_PATH, ...args], {
			env: {
				...process.env,
				NODE_OPTIONS: "--disable-warning=ExperimentalWarning",
				...env,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (c: Buffer) => {
			stdout += c.toString("utf-8");
		});
		child.stderr?.on("data", (c: Buffer) => {
			stderr += c.toString("utf-8");
		});
		child.on("exit", (code) => resolve({ code, stdout, stderr }));
	});
}

/** Run an arbitrary `docker …` command, collecting stdout/stderr. */
export function docker(
	args: string[],
	cwd: string | null = null,
): Promise<RunResult> {
	return new Promise((resolve) => {
		const child = spawn(DOCKER_BIN, args, {
			cwd: cwd ?? undefined,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (c: Buffer) => {
			stdout += c.toString("utf-8");
		});
		child.stderr?.on("data", (c: Buffer) => {
			stderr += c.toString("utf-8");
		});
		child.on("error", (err) => {
			resolve({ code: 1, stdout, stderr: `${stderr}${err.message}` });
		});
		child.on("exit", (code) => resolve({ code, stdout, stderr }));
	});
}

/** Run `docker compose -p <project> …` from the given unit dir. */
export function compose(
	project: string,
	args: string[],
	cwd: string,
): Promise<RunResult> {
	return docker(["compose", "-p", project, ...args], cwd);
}

/** Tolerant teardown: `docker compose -p <project> down [-v]`, ignore errors. */
export async function composeDown(
	target: CleanupTarget,
	removeVolumes: boolean,
): Promise<void> {
	const args = removeVolumes ? ["down", "-v"] : ["down"];
	await compose(target.project, args, target.cwd);
}

/** `docker volume ls` stdout (one volume name per line). */
export async function volumeList(): Promise<string> {
	const res = await docker(["volume", "ls", "--format", "{{.Name}}"]);
	return res.stdout;
}

/** Whether `docker volume ls` currently lists the given volume name. */
export async function hasVolume(name: string): Promise<boolean> {
	const list = await volumeList();
	return list
		.split("\n")
		.map((l) => l.trim())
		.includes(name);
}

// ─── Health poll ─────────────────────────────────────────

/**
 * Poll `GET http://127.0.0.1:<port>/` until HTTP 200, bounded by `timeoutMs`.
 * On timeout, fails with the collected `docker compose logs` so a stuck
 * container is diagnosable. A cold `--build` needs the larger budget.
 */
export async function pollHealthy(
	port: number,
	timeoutMs: number,
	onTimeoutLogs: () => Promise<string>,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastErr = "";
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/`);
			if (res.status === 200) {
				await res.text();
				return;
			}
			lastErr = `status ${res.status}`;
		} catch (err) {
			lastErr = err instanceof Error ? err.message : String(err);
		}
		await sleep(500);
	}
	const logs = await onTimeoutLogs();
	throw new Error(
		`health poll timed out after ${timeoutMs}ms on port ${port} (last: ${lastErr})\n--- compose logs ---\n${logs}`,
	);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── HTTP / SSE round-trip ───────────────────────────────

function headerMap(res: Response): Record<string, string> {
	const out: Record<string, string> = {};
	res.headers.forEach((value, key) => {
		out[key.toLowerCase()] = value;
	});
	return out;
}

/** `GET <url>` → decoded text response. */
export async function httpGet(url: string): Promise<HttpResponse> {
	const res = await fetch(url);
	const body = await res.text();
	return { status: res.status, headers: headerMap(res), body };
}

/** `POST <url>` with an optional JSON body → decoded text response. */
export async function httpPost(
	url: string,
	jsonBody: unknown = null,
): Promise<HttpResponse> {
	const res = await fetch(url, {
		method: "POST",
		headers: jsonBody === null ? {} : { "content-type": "application/json" },
		body: jsonBody === null ? undefined : JSON.stringify(jsonBody),
	});
	const body = await res.text();
	return { status: res.status, headers: headerMap(res), body };
}

/** `POST <url>` returning the raw response bytes (used for export). */
export async function httpPostBytes(
	url: string,
): Promise<{ status: number; headers: Record<string, string>; bytes: Buffer }> {
	const res = await fetch(url, { method: "POST" });
	const buf = Buffer.from(await res.arrayBuffer());
	return { status: res.status, headers: headerMap(res), bytes: buf };
}

/**
 * POST a `{ content }` message and read the whole SSE stream as text. The fake
 * agent finishes immediately, so the server emits `event: done` then closes —
 * `res.text()` resolves with the full event stream.
 */
export async function postSse(
	url: string,
	content: string,
): Promise<HttpResponse> {
	return httpPost(url, { content });
}

/** Count SSE `event: <name>` lines of a given name in a stream body. */
export function countSseEvents(stream: string, name: string): number {
	let count = 0;
	for (const line of stream.split("\n")) {
		if (line.trim() === `event: ${name}`) count += 1;
	}
	return count;
}

// ─── Deterministic fake-hermes seam ──────────────────────

/**
 * The fake `hermes` script. It speaks the minimal `hermes chat` contract the
 * adapter consumes:
 *   - create (`chat -q ping … --pass-session-id`, no `--resume`): mints a
 *     `YYYYMMDD_HHMMSS_<hex>` session id, seeds the per-session JSONL with a
 *     `session_meta` row, and prints `session_id: <id>` to stderr.
 *   - send (`chat -q <content> --resume <id> …`): appends one deterministic
 *     assistant turn to `$HOME/.hermes/sessions/<id>.jsonl` and re-prints the
 *     id. The server records its own user turn separately, so the assistant
 *     turn is the one that surfaces as `event: turn`.
 * No LLM, no credentials, no network — fully hermetic.
 */
const FAKE_HERMES = [
	"#!/usr/bin/env node",
	'"use strict";',
	'const fs = require("node:fs");',
	'const os = require("node:os");',
	'const path = require("node:path");',
	"const argv = process.argv.slice(2);",
	"function argAfter(flag) {",
	"  const i = argv.indexOf(flag);",
	"  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;",
	"}",
	"const home = process.env.HOME || os.homedir();",
	'const sessionsDir = path.join(home, ".hermes", "sessions");',
	"fs.mkdirSync(sessionsDir, { recursive: true });",
	"function pad(n, l) { return String(n).padStart(l, '0'); }",
	"function mintId() {",
	"  const d = new Date();",
	"  const date = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;",
	"  const time = `${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}`;",
	"  const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');",
	"  return `${date}_${time}_${hex}`;",
	"}",
	'const resume = argAfter("--resume");',
	"if (resume === null) {",
	"  const id = mintId();",
	"  const file = path.join(sessionsDir, `${id}.jsonl`);",
	'  fs.writeFileSync(file, JSON.stringify({ role: "session_meta", id }) + "\\n");',
	"  process.stderr.write(`session_id: ${id}\\n`);",
	"  process.exit(0);",
	"}",
	'const content = argAfter("-q") || "";',
	"const file = path.join(sessionsDir, `${resume}.jsonl`);",
	"const ts = new Date().toISOString();",
	'const reply = "pong: " + content;',
	'fs.appendFileSync(file, JSON.stringify({ role: "assistant", content: reply, timestamp: ts }) + "\\n");',
	"process.stderr.write(`session_id: ${resume}\\n`);",
	"process.exit(0);",
	"",
].join("\n");

/**
 * Write the executable fake `hermes` into a host workspace dir (the dir
 * bind-mounted to `/workspace`). The container resolves it at
 * `/workspace/fake-hermes` via `gateways.hermes.config.hermesBin`.
 *
 * Critical: the container runs as the non-root `sumeru` user (uid 10001), so
 * BOTH the workspace dir and the script must be world-traversable / -executable.
 * `mkdtempSync` (the unit-dir source) defaults to mode `0700`, which the
 * container uid cannot search — the bind mount then yields `EACCES` on
 * `/workspace/fake-hermes` and `createSession` fails (adapter spawn error),
 * cascading to 404/502 on every downstream session route. `0755` on the dir
 * (o+rx) + `0755` on the script (o+rx) is the minimum that lets uid 10001 reach
 * and exec it.
 */
export function writeFakeHermes(workspaceDir: string): string {
	mkdirSync(workspaceDir, { recursive: true });
	chmodSync(workspaceDir, 0o755);
	const p = join(workspaceDir, "fake-hermes");
	writeFileSync(p, FAKE_HERMES, "utf-8");
	chmodSync(p, 0o755);
	return p;
}

// ─── Config fixtures ─────────────────────────────────────

/** Write a `sumeru.yaml` into a unit dir and return its path. */
export function writeConfig(unitDir: string, yaml: string): string {
	const configPath = join(unitDir, "sumeru.yaml");
	writeFileSync(configPath, yaml, "utf-8");
	return configPath;
}

/** alpha.yaml — primary docker unit (host port 7901). `name` is the instance
 * identity AND the compose project / volume prefix (the CLI launches with
 * `-p <name>`), so callers pass a per-case-unique name to isolate runs. */
export function alphaConfig(workspaceDir: string, name = "alpha"): string {
	return [
		`name: ${name}`,
		"workspaceRoot: /workspace",
		"deploy:",
		"  mode: docker",
		"  port: 7901",
		`  workspace: ${workspaceDir}`,
		"gateways:",
		"  hermes:",
		"    adapter: hermes",
		"    config:",
		"      hermesBin: /workspace/fake-hermes",
		"    capabilities: { resume: true, streaming: true }",
		"",
	].join("\n");
}

/** beta.yaml — second unit, distinct port (7902) for isolation. `name`
 * doubles as the compose project / volume prefix (see {@link alphaConfig}). */
export function betaConfig(workspaceDir: string, name = "beta"): string {
	return [
		`name: ${name}`,
		"workspaceRoot: /workspace",
		"deploy:",
		"  mode: docker",
		"  port: 7902",
		`  workspace: ${workspaceDir}`,
		"gateways:",
		"  hermes:",
		"    adapter: hermes",
		"    config:",
		"      hermesBin: /workspace/fake-hermes",
		"    capabilities: { resume: true, streaming: true }",
		"",
	].join("\n");
}

/**
 * degraded.yaml — exercises the REAL gateway-degradation contract.
 *
 * `GET /gateways` `status` is derived from adapter-name *registration*, not from
 * a runtime binary probe (`cli-pass-gateway-config.md`: a gateway whose adapter
 * is one of the bundled names — hermes / claude-code / codex / cursor-agent —
 * is `ready`; an UNKNOWN adapter name is `unavailable`). So:
 *   - `hermes`      — bundled, fake-hermes bin present → `ready`, fully usable.
 *   - `claude-code` — bundled adapter, but the image ships no `claude` binary →
 *     still `ready` (the missing binary only surfaces lazily at createSession /
 *     send, never on the gateway list). Documents that a missing agent binary
 *     is NOT a boot-time fatal and does NOT flip the list status.
 *   - `bogus`       — an unknown adapter name → `unavailable`, the actual
 *     degraded state the list reports, and it must not crash the instance.
 * See `specs/integration/docker-gateway-status-semantics.md` for the gap
 * between this real contract and the (aspirational) binary-probe wording.
 */
export function degradedConfig(
	workspaceDir: string,
	name = "degraded",
): string {
	return [
		`name: ${name}`,
		"workspaceRoot: /workspace",
		"deploy:",
		"  mode: docker",
		"  port: 7903",
		`  workspace: ${workspaceDir}`,
		"gateways:",
		"  hermes:",
		"    adapter: hermes",
		"    config:",
		"      hermesBin: /workspace/fake-hermes",
		"    capabilities: { resume: true, streaming: true }",
		"  claude-code:",
		"    adapter: claude-code",
		"    capabilities: { resume: true, streaming: false }",
		"  bogus:",
		"    adapter: bogus",
		"    capabilities: { resume: false, streaming: false }",
		"",
	].join("\n");
}

// ─── tar / gzip export decode ────────────────────────────

/** Decompress a gzipped buffer (the export body) to its raw tar bytes. */
export function gunzip(buf: Buffer): Buffer {
	return gunzipSync(buf);
}

/**
 * List the entry names of a (decompressed) ustar archive using only built-ins.
 * The export writes short names (`cas/<13-char-hash>.bin`, `vars.jsonl`,
 * `tags.jsonl`), well within the 100-byte name field, so a minimal 512-byte
 * block walk is sufficient. A `prefix` field (ustar) is honored if present.
 */
export function tarEntryNames(tar: Buffer): string[] {
	const names: string[] = [];
	let off = 0;
	while (off + 512 <= tar.length) {
		const block = tar.subarray(off, off + 512);
		if (isZeroBlock(block)) break;
		const name = readField(block, 0, 100);
		const prefix = readField(block, 345, 155);
		const sizeOctal = readField(block, 124, 12).trim();
		const size = sizeOctal.length > 0 ? Number.parseInt(sizeOctal, 8) : 0;
		const full = prefix.length > 0 ? `${prefix}/${name}` : name;
		if (full.length > 0) names.push(full);
		const dataBlocks = Math.ceil(size / 512);
		off += 512 + dataBlocks * 512;
	}
	return names;
}

/** A decoded ustar entry: its full path + raw file content bytes. */
export type TarEntry = { name: string; content: Buffer };

/**
 * Decode a (decompressed) ustar archive into its entries (name + content),
 * using only built-ins — same 512-byte block walk as {@link tarEntryNames} but
 * also slicing out each entry's payload.
 *
 * This is the semantic counterpart to a raw-byte tar compare: two exports of
 * the same recording yield the same ENTRIES (CAS `cas/<hash>.bin` blobs +
 * `vars.jsonl` / `tags.jsonl`), even though their tar headers differ in the
 * `mtime` field. The persistence contract under test (Then-4) is "the recorded
 * DATA survives a restart", which lives in the entry payloads, not in the tar
 * envelope's filesystem metadata — so the suite compares entries, not bytes.
 * (Byte-level export determinism is `@ocas/core`'s own contract, guarded by its
 * unit tests; see the note in docker-mode.test.ts Then-4.)
 */
export function tarEntries(tar: Buffer): TarEntry[] {
	const entries: TarEntry[] = [];
	let off = 0;
	while (off + 512 <= tar.length) {
		const block = tar.subarray(off, off + 512);
		if (isZeroBlock(block)) break;
		const name = readField(block, 0, 100);
		const prefix = readField(block, 345, 155);
		const sizeOctal = readField(block, 124, 12).trim();
		const size = sizeOctal.length > 0 ? Number.parseInt(sizeOctal, 8) : 0;
		const full = prefix.length > 0 ? `${prefix}/${name}` : name;
		const content = Buffer.from(tar.subarray(off + 512, off + 512 + size));
		if (full.length > 0) entries.push({ name: full, content });
		const dataBlocks = Math.ceil(size / 512);
		off += 512 + dataBlocks * 512;
	}
	return entries;
}

/**
 * Canonicalize tar entries for a semantic equality compare: sort by name and
 * stringify each as `<name>\n<hex-content>`. Two recordings with identical CAS
 * closures produce identical canonical strings regardless of tar entry order or
 * header metadata (e.g. the non-deterministic `mtime` `@ocas/core` writes).
 */
export function canonicalTarEntries(tar: Buffer): string {
	return tarEntries(tar)
		.map((e) => `${e.name}\n${e.content.toString("hex")}`)
		.sort()
		.join("\n--\n");
}

function isZeroBlock(block: Buffer): boolean {
	for (const byte of block) {
		if (byte !== 0) return false;
	}
	return true;
}

function readField(block: Buffer, start: number, len: number): string {
	const slice = block.subarray(start, start + len);
	const nul = slice.indexOf(0);
	const end = nul === -1 ? len : nul;
	return slice.subarray(0, end).toString("utf-8");
}
