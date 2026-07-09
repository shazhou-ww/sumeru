/**
 * Lazy initialization and host auto-start for the Sumeru CLI.
 *
 * - ensureRootDir(): creates ~/.sumeru/ structure + host.yaml if missing
 * - ensureHost(): probes host → spawns if unreachable → waits for ready
 * - getClient(): ensureRootDir + ensureHost + return HostClient
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHostClient, type HostClient } from "./http-client.js";
import { resolvePidFilePath, writePidFile } from "./pid-file.js";

// ── Config resolution ───────────────────────────────────────────────

function resolveHost(): string {
	return process.env.SUMERU_HOST ?? "127.0.0.1";
}

function resolvePort(): number {
	const raw = process.env.SUMERU_PORT ?? "7900";
	const port = Number.parseInt(raw, 10);
	if (!Number.isFinite(port) || port < 0) {
		throw new Error(`Invalid SUMERU_PORT: ${raw}`);
	}
	return port;
}

export function resolveBaseUrl(): string {
	return `http://${resolveHost()}:${String(resolvePort())}`;
}

export function resolveRootDir(): string {
	return process.env.SUMERU_ROOT ?? join(homedir(), ".sumeru");
}

// ── Lazy init ───────────────────────────────────────────────────────

export function ensureRootDir(): string {
	const rootDir = resolveRootDir();
	if (existsSync(join(rootDir, "host.yaml"))) {
		return rootDir;
	}

	// Create directory tree
	const dirs = [
		rootDir,
		join(rootDir, "data"),
		join(rootDir, "data", "prototypes"),
		join(rootDir, "data", "skills"),
		join(rootDir, "data", "extensions"),
		join(rootDir, "prototypes"),
		join(rootDir, "workspace"),
	];
	for (const dir of dirs) {
		mkdirSync(dir, { recursive: true });
	}

	// Write host.yaml
	const hostYaml = [
		"name: sumeru",
		"maxRunning: 3",
		`workspaceRoot: ${rootDir}/workspace`,
		`envFile: ${rootDir}/.env`,
		"defaults:",
		"  model: null",
	].join("\n");
	writeFileSync(join(rootDir, "host.yaml"), `${hostYaml}\n`);

	// Create empty .env if not exists
	if (!existsSync(join(rootDir, ".env"))) {
		writeFileSync(join(rootDir, ".env"), "", { mode: 0o600 });
	}

	return rootDir;
}

// ── Lazy start ──────────────────────────────────────────────────────

async function isHostReachable(baseUrl: string): Promise<boolean> {
	try {
		const response = await fetch(`${baseUrl}/`, {
			signal: AbortSignal.timeout(2000),
		});
		return response.ok;
	} catch {
		return false;
	}
}

function findHostMain(): string {
	// Relative to this file: ../../host/dist/main.js
	return resolve(
		dirname(new URL(import.meta.url).pathname),
		"../../host/dist/main.js",
	);
}

async function spawnHost(rootDir: string): Promise<void> {
	const host = resolveHost();
	const port = String(resolvePort());
	const hostMain = findHostMain();

	const child = spawn("node", [hostMain, rootDir], {
		stdio: "ignore",
		env: {
			...process.env,
			SUMERU_HOST: host,
			SUMERU_PORT: port,
		},
		detached: true,
	});

	if (child.pid === undefined) {
		throw new Error(
			`Could not start host. Run manually:\n  SUMERU_HOST=${host} SUMERU_PORT=${port} node ${hostMain} ${rootDir}`,
		);
	}

	child.unref();

	// Write PID file
	const pidFile = resolvePidFilePath();
	writePidFile(pidFile, child.pid);

	// Wait for host to become ready (up to 10s)
	const baseUrl = `http://${host}:${port}`;
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		if (await isHostReachable(baseUrl)) {
			return;
		}
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error(
		`Host started (pid ${String(child.pid)}) but not reachable after 10s at ${baseUrl}`,
	);
}

// ── Public: get a ready client ──────────────────────────────────────

export async function getClient(): Promise<HostClient> {
	const rootDir = ensureRootDir();
	const baseUrl = resolveBaseUrl();

	if (!(await isHostReachable(baseUrl))) {
		await spawnHost(rootDir);
	}

	return createHostClient({ baseUrl });
}
