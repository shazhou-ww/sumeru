#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import {
	formatDockerImagesOutput,
	formatHostStatus,
	formatInstanceTable,
	formatPrototypeTable,
} from "./format.js";
import { createHostClient, HostClientError } from "./http-client.js";
import {
	isProcessAlive,
	readPidFile,
	removePidFile,
	resolvePidFilePath,
	writePidFile,
} from "./pid-file.js";

const HELP_TEXT = `Usage: sumeru <command> [options]

Commands:
  server start [--config <path>] [--host <host>] [--port <port>]
  server stop
  server status
  prototypes
  instances
  create <prototype> [--project <path>...]
  delete <instance_id>
  send <instance_id> <message>
  logs <instance_id> [--follow]
  reset <instance_id>
  images

Environment:
  SUMERU_HOST       Host bind address for API client (default: 127.0.0.1)
  SUMERU_PORT       Host port for API client (default: 7900)
  SUMERU_PID_FILE   PID file path for server start/stop
`;

type ParsedArgs = {
	command: Array<string>;
	positionals: Array<string>;
	flags: Map<string, string | boolean>;
};

function parseArgs(argv: Array<string>): ParsedArgs {
	const command: Array<string> = [];
	const positionals: Array<string> = [];
	const flags = new Map<string, string | boolean>();
	let i = 0;
	while (i < argv.length) {
		const token = argv[i];
		if (token === undefined) break;
		if (token.startsWith("--")) {
			const key = token.slice(2);
			const next = argv[i + 1];
			if (next !== undefined && !next.startsWith("-")) {
				flags.set(key, next);
				i += 2;
				continue;
			}
			flags.set(key, true);
			i += 1;
			continue;
		}
		if (token.startsWith("-") && token.length > 1) {
			const key = token.slice(1);
			const next = argv[i + 1];
			if (next !== undefined && !next.startsWith("-")) {
				flags.set(key, next);
				i += 2;
				continue;
			}
			flags.set(key, true);
			i += 1;
			continue;
		}
		if (command.length < 2) {
			command.push(token);
		} else {
			positionals.push(token);
		}
		i += 1;
	}
	return { command, positionals, flags };
}

function flagString(
	flags: Map<string, string | boolean>,
	...names: Array<string>
): string | null {
	for (const name of names) {
		const value = flags.get(name);
		if (typeof value === "string" && value.length > 0) return value;
	}
	return null;
}

function flagBoolean(
	flags: Map<string, string | boolean>,
	name: string,
): boolean {
	const value = flags.get(name);
	return value === true || value === "true";
}

function resolveBaseUrl(flags: Map<string, string | boolean>): string {
	const host =
		flagString(flags, "host") ?? process.env.SUMERU_HOST ?? "127.0.0.1";
	const portRaw =
		flagString(flags, "port") ?? process.env.SUMERU_PORT ?? "7900";
	const port = Number.parseInt(portRaw, 10);
	if (!Number.isFinite(port) || port < 0) {
		fail("Invalid port");
	}
	return `http://${host}:${String(port)}`;
}

function fail(message: string): never {
	process.stderr.write(`${message}\n`);
	process.exit(1);
}

function printHelp(): void {
	process.stdout.write(HELP_TEXT);
}

async function runServerStart(
	flags: Map<string, string | boolean>,
): Promise<void> {
	const configPath = flagString(flags, "config", "c");
	const host =
		flagString(flags, "host") ?? process.env.SUMERU_HOST ?? "127.0.0.1";
	const portRaw =
		flagString(flags, "port") ?? process.env.SUMERU_PORT ?? "7900";
	const rootDir =
		configPath !== null ? resolve(dirname(configPath)) : process.cwd();
	const pidFilePath = resolvePidFilePath();
	const existingPid = readPidFile(pidFilePath);
	if (existingPid !== null && isProcessAlive(existingPid)) {
		fail(
			`Host already running (pid ${String(existingPid)}). Stop it first with \`sumeru server stop\`.`,
		);
	}
	if (existingPid !== null) {
		removePidFile(pidFilePath);
	}

	const hostBin = process.env.SUMERU_HOST_BIN ?? "sumeru-host";
	const child = spawn(hostBin, [rootDir], {
		stdio: "inherit",
		env: {
			...process.env,
			SUMERU_HOST: host,
			SUMERU_PORT: portRaw,
		},
		detached: true,
	});

	if (child.pid === undefined) {
		process.stdout.write(
			`Could not spawn ${hostBin}. Start the host manually:\n\n` +
				`  SUMERU_HOST=${host} SUMERU_PORT=${portRaw} ${hostBin} ${rootDir}\n`,
		);
		process.exit(1);
	}

	writePidFile(pidFilePath, child.pid);
	child.unref();
	process.stdout.write(
		`Started host pid ${String(child.pid)} (${hostBin} ${rootDir})\n` +
			`PID file: ${pidFilePath}\n`,
	);
}

function runServerStop(): void {
	const pidFilePath = resolvePidFilePath();
	const pid = readPidFile(pidFilePath);
	if (pid === null) {
		process.stdout.write(
			`No PID file at ${pidFilePath}.\n` +
				`If the host is running, stop it with: kill $(cat ${pidFilePath})\n`,
		);
		return;
	}
	if (!isProcessAlive(pid)) {
		removePidFile(pidFilePath);
		process.stdout.write(
			`Removed stale PID file (pid ${String(pid)} not running).\n`,
		);
		return;
	}
	try {
		process.kill(pid, "SIGTERM");
		process.stdout.write(`Sent SIGTERM to host pid ${String(pid)}.\n`);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		fail(`Failed to stop pid ${String(pid)}: ${msg}`);
	}
}

async function runServerStatus(
	flags: Map<string, string | boolean>,
): Promise<void> {
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		const envelope = await client.getRoot();
		process.stdout.write(`${formatHostStatus(envelope.value)}\n`);
	} catch (err) {
		writeClientError(err);
	}
}

async function runPrototypes(
	flags: Map<string, string | boolean>,
): Promise<void> {
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		const envelope = await client.listPrototypes();
		process.stdout.write(`${formatPrototypeTable(envelope.value)}\n`);
	} catch (err) {
		writeClientError(err);
	}
}

async function runInstances(
	flags: Map<string, string | boolean>,
): Promise<void> {
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		const envelope = await client.listInstances();
		process.stdout.write(`${formatInstanceTable(envelope.value)}\n`);
	} catch (err) {
		writeClientError(err);
	}
}

async function runCreate(
	flags: Map<string, string | boolean>,
	positionals: Array<string>,
): Promise<void> {
	const prototype = positionals[0];
	if (prototype === undefined || prototype.length === 0) {
		fail("Usage: sumeru create <prototype> [--project <path>...]");
	}
	const projects = collectProjects(flags, positionals.slice(1));
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		const envelope = await client.createInstance(prototype, projects);
		process.stdout.write(`${envelope.value.id}\n`);
	} catch (err) {
		writeClientError(err);
	}
}

function collectProjects(
	flags: Map<string, string | boolean>,
	extraPositionals: Array<string>,
): Array<string> | null {
	const projects: Array<string> = [];
	for (const [key, value] of flags.entries()) {
		if (key === "project" && typeof value === "string") {
			projects.push(value);
		}
	}
	for (const positional of extraPositionals) {
		if (positional.length > 0) {
			projects.push(positional);
		}
	}
	return projects.length > 0 ? projects : null;
}

async function runDelete(
	flags: Map<string, string | boolean>,
	positionals: Array<string>,
): Promise<void> {
	const instanceId = positionals[0];
	if (instanceId === undefined || instanceId.length === 0) {
		fail("Usage: sumeru delete <instance_id>");
	}
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		await client.deleteInstance(instanceId);
		process.stdout.write(`deleted ${instanceId}\n`);
	} catch (err) {
		writeClientError(err);
	}
}

async function runSend(
	flags: Map<string, string | boolean>,
	positionals: Array<string>,
): Promise<void> {
	const instanceId = positionals[0];
	const message = positionals.slice(1).join(" ");
	if (
		instanceId === undefined ||
		instanceId.length === 0 ||
		message.length === 0
	) {
		fail("Usage: sumeru send <instance_id> <message>");
	}
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		const envelope = await client.submitInbox(instanceId, {
			messageId: `msg_${randomUUID()}`,
			content: message,
			project: null,
		});
		process.stdout.write(
			`accepted message ${envelope.value.messageId} for ${envelope.value.instanceId}\n`,
		);
	} catch (err) {
		writeClientError(err);
	}
}

async function runLogs(
	flags: Map<string, string | boolean>,
	positionals: Array<string>,
): Promise<void> {
	const instanceId = positionals[0];
	if (instanceId === undefined || instanceId.length === 0) {
		fail("Usage: sumeru logs <instance_id> [--follow]");
	}
	const follow = flagBoolean(flags, "follow");
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });

	const printEvent = (event: string, data: string): void => {
		if (event === "heartbeat") return;
		process.stdout.write(`event: ${event}\n`);
		process.stdout.write(`data: ${data}\n\n`);
	};

	try {
		do {
			await client.streamOutbox(instanceId, printEvent);
			if (!follow) break;
		} while (follow);
	} catch (err) {
		writeClientError(err);
	}
}

async function runReset(
	flags: Map<string, string | boolean>,
	positionals: Array<string>,
): Promise<void> {
	const instanceId = positionals[0];
	if (instanceId === undefined || instanceId.length === 0) {
		fail("Usage: sumeru reset <instance_id>");
	}
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		await client.resetInstance(instanceId);
		process.stdout.write(`reset ${instanceId}\n`);
	} catch (err) {
		writeClientError(err);
	}
}

function runImages(): void {
	const result = spawnSync("docker", ["images", "sumeru/*"], {
		encoding: "utf-8",
	});
	if (result.error !== undefined) {
		fail(`docker images failed: ${result.error.message}`);
	}
	if (result.status !== 0) {
		const stderr = result.stderr.trim();
		fail(
			stderr.length > 0
				? stderr
				: `docker images exited ${String(result.status)}`,
		);
	}
	process.stdout.write(`${formatDockerImagesOutput(result.stdout)}\n`);
}

function writeClientError(err: unknown): never {
	if (err instanceof HostClientError) {
		fail(`${err.code}: ${err.message}`);
	}
	const msg = err instanceof Error ? err.message : String(err);
	fail(msg);
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
		printHelp();
		return;
	}

	const parsed = parseArgs(argv);
	const [cmd, sub] = parsed.command;

	if (cmd === "server") {
		if (sub === "start") {
			await runServerStart(parsed.flags);
			return;
		}
		if (sub === "stop") {
			runServerStop();
			return;
		}
		if (sub === "status") {
			await runServerStatus(parsed.flags);
			return;
		}
		fail(`Unknown server subcommand: ${sub ?? "(none)"}`);
	}

	if (cmd === "prototypes") {
		await runPrototypes(parsed.flags);
		return;
	}
	if (cmd === "instances") {
		await runInstances(parsed.flags);
		return;
	}
	if (cmd === "create") {
		await runCreate(parsed.flags, parsed.positionals);
		return;
	}
	if (cmd === "delete") {
		await runDelete(parsed.flags, parsed.positionals);
		return;
	}
	if (cmd === "send") {
		await runSend(parsed.flags, parsed.positionals);
		return;
	}
	if (cmd === "logs") {
		await runLogs(parsed.flags, parsed.positionals);
		return;
	}
	if (cmd === "reset") {
		await runReset(parsed.flags, parsed.positionals);
		return;
	}
	if (cmd === "images") {
		runImages();
		return;
	}

	fail(`Unknown command: ${cmd ?? "(none)"}. Run \`sumeru --help\`.`);
}

await main();
