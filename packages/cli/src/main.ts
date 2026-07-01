#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import {
	formatDockerImagesOutput,
	formatHostStatus,
	formatImageTable,
	formatModelTable,
	formatPrototypeTable,
	formatProviderTable,
	formatSessionTable,
} from "./format.js";
import { createHostClient, HostClientError } from "./http-client.js";
import {
	runImageBuild as executeImageBuild,
	findRepoRoot,
} from "./image-build.js";
import {
	isProcessAlive,
	readPidFile,
	removePidFile,
	resolvePidFilePath,
	writePidFile,
} from "./pid-file.js";
import { runSetup } from "./setup.js";

const HELP_TEXT = `Usage: sumeru <command> [options]

Commands:
  setup --provider <name> --api-key <key> --model <model-name>
        [--api-type <type>] [--base-url <url>] [--root-dir <path>]
  server start [--config <path>] [--host <host>] [--port <port>]
  server stop
  server status
  prototypes
  prototype list
  prototype add <name> --model <model-id> --image <image-name> [--persona <name>]
  prototype remove <name>
  provider list
  provider add <name> --api-type <type> --base-url <url> [--api-key <key>]
  provider remove <name>
  model list
  model add <id> --provider <name> --model <model> [--context-window N] [--no-tool-use] [--no-streaming]
  model remove <id>
  image build <name> --agent <type> [--adapter <pkg-or-path>]
  image list
  sessions
  create <prototype> --project <path> --task <description>
  delete <session_id>
  send <session_id> <message>
  logs <session_id> [--follow]
  stop <session_id>
  images

Setup:
  Initialize ~/.sumeru with config, prototype, and SQLite data.
  Known providers (auto-detect apiType + baseUrl): anthropic, openai, openrouter, siliconflow, deepseek.
  Custom providers require --api-type and --base-url.

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

async function runPrototypeAdd(
	flags: Map<string, string | boolean>,
	positionals: Array<string>,
): Promise<void> {
	const name = positionals[0];
	const model = flagString(flags, "model");
	const image = flagString(flags, "image");
	const persona = flagString(flags, "persona") ?? "default";
	if (
		name === undefined ||
		name.length === 0 ||
		model === null ||
		image === null
	) {
		fail(
			"Usage: sumeru prototype add <name> --model <model-id> --image <image-name> [--persona <name>]",
		);
	}
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		const envelope = await client.createPrototype(name, {
			persona,
			model,
			image,
		});
		process.stdout.write(`${envelope.value.name}\n`);
	} catch (err) {
		writeClientError(err);
	}
}

async function runPrototypeRemove(
	flags: Map<string, string | boolean>,
	positionals: Array<string>,
): Promise<void> {
	const name = positionals[0];
	if (name === undefined || name.length === 0) {
		fail("Usage: sumeru prototype remove <name>");
	}
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		await client.deletePrototype(name);
		process.stdout.write(`removed prototype ${name}\n`);
	} catch (err) {
		writeClientError(err);
	}
}

async function runProviderList(
	flags: Map<string, string | boolean>,
): Promise<void> {
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		const envelope = await client.listProviders();
		process.stdout.write(`${formatProviderTable(envelope.value)}\n`);
	} catch (err) {
		writeClientError(err);
	}
}

async function runProviderAdd(
	flags: Map<string, string | boolean>,
	positionals: Array<string>,
): Promise<void> {
	const name = positionals[0];
	const apiType = flagString(flags, "api-type");
	const baseUrl = flagString(flags, "base-url");
	const apiKey = flagString(flags, "api-key");
	if (
		name === undefined ||
		name.length === 0 ||
		apiType === null ||
		baseUrl === null
	) {
		fail(
			"Usage: sumeru provider add <name> --api-type <type> --base-url <url> [--api-key <key>]",
		);
	}
	if (apiType !== "anthropic" && apiType !== "openai") {
		fail('Flag --api-type must be "anthropic" or "openai"');
	}
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		const envelope = await client.createProvider(name, {
			apiType,
			baseUrl,
			apiKey,
		});
		process.stdout.write(`${envelope.value.name}\n`);
	} catch (err) {
		writeClientError(err);
	}
}

async function runProviderRemove(
	flags: Map<string, string | boolean>,
	positionals: Array<string>,
): Promise<void> {
	const name = positionals[0];
	if (name === undefined || name.length === 0) {
		fail("Usage: sumeru provider remove <name>");
	}
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		await client.deleteProvider(name);
		process.stdout.write(`removed provider ${name}\n`);
	} catch (err) {
		writeClientError(err);
	}
}

async function runModelList(
	flags: Map<string, string | boolean>,
): Promise<void> {
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		const envelope = await client.listModels();
		process.stdout.write(`${formatModelTable(envelope.value)}\n`);
	} catch (err) {
		writeClientError(err);
	}
}

async function runModelAdd(
	flags: Map<string, string | boolean>,
	positionals: Array<string>,
): Promise<void> {
	const id = positionals[0];
	const provider = flagString(flags, "provider");
	const model = flagString(flags, "model");
	const contextWindowRaw = flagString(flags, "context-window");
	if (
		id === undefined ||
		id.length === 0 ||
		provider === null ||
		model === null
	) {
		fail(
			"Usage: sumeru model add <id> --provider <name> --model <model> [--context-window N] [--no-tool-use] [--no-streaming]",
		);
	}
	let contextWindow: number | null = null;
	if (contextWindowRaw !== null) {
		const parsed = Number.parseInt(contextWindowRaw, 10);
		if (!Number.isFinite(parsed)) {
			fail("Flag --context-window must be a finite number");
		}
		contextWindow = parsed;
	}
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		const envelope = await client.createModel(id, {
			provider,
			model,
			contextWindow,
			toolUse: !flagBoolean(flags, "no-tool-use"),
			streaming: !flagBoolean(flags, "no-streaming"),
			metadata: null,
		});
		process.stdout.write(`${envelope.value.id}\n`);
	} catch (err) {
		writeClientError(err);
	}
}

async function runModelRemove(
	flags: Map<string, string | boolean>,
	positionals: Array<string>,
): Promise<void> {
	const id = positionals[0];
	if (id === undefined || id.length === 0) {
		fail("Usage: sumeru model remove <id>");
	}
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		await client.deleteModel(id);
		process.stdout.write(`removed model ${id}\n`);
	} catch (err) {
		writeClientError(err);
	}
}

async function runSessions(
	flags: Map<string, string | boolean>,
): Promise<void> {
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		const envelope = await client.listSessions();
		process.stdout.write(`${formatSessionTable(envelope.value)}\n`);
	} catch (err) {
		writeClientError(err);
	}
}

async function runCreate(
	flags: Map<string, string | boolean>,
	positionals: Array<string>,
): Promise<void> {
	const prototype = positionals[0];
	const project = flagString(flags, "project");
	const task = flagString(flags, "task");
	if (
		prototype === undefined ||
		prototype.length === 0 ||
		project === null ||
		task === null
	) {
		fail(
			"Usage: sumeru create <prototype> --project <path> --task <description>",
		);
	}
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		const envelope = await client.createSession({
			prototype,
			project,
			task,
			model: null,
			env: null,
		});
		process.stdout.write(`${envelope.value.id}\n`);
	} catch (err) {
		writeClientError(err);
	}
}

async function runDelete(
	flags: Map<string, string | boolean>,
	positionals: Array<string>,
): Promise<void> {
	const sessionId = positionals[0];
	if (sessionId === undefined || sessionId.length === 0) {
		fail("Usage: sumeru delete <session_id>");
	}
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		await client.deleteSession(sessionId);
		process.stdout.write(`deleted ${sessionId}\n`);
	} catch (err) {
		writeClientError(err);
	}
}

async function runSend(
	flags: Map<string, string | boolean>,
	positionals: Array<string>,
): Promise<void> {
	const sessionId = positionals[0];
	const message = positionals.slice(1).join(" ");
	if (
		sessionId === undefined ||
		sessionId.length === 0 ||
		message.length === 0
	) {
		fail("Usage: sumeru send <session_id> <message>");
	}
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		const envelope = await client.submitMessage(sessionId, {
			content: message,
			env: null,
			model: null,
		});
		process.stdout.write(
			`accepted message ${envelope.value.messageId} for ${envelope.value.sessionId}\n`,
		);
	} catch (err) {
		writeClientError(err);
	}
}

async function runLogs(
	flags: Map<string, string | boolean>,
	positionals: Array<string>,
): Promise<void> {
	const sessionId = positionals[0];
	if (sessionId === undefined || sessionId.length === 0) {
		fail("Usage: sumeru logs <session_id> [--follow]");
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
			await client.streamEvents(sessionId, printEvent);
			if (!follow) break;
		} while (follow);
	} catch (err) {
		writeClientError(err);
	}
}

async function runStop(
	flags: Map<string, string | boolean>,
	positionals: Array<string>,
): Promise<void> {
	const sessionId = positionals[0];
	if (sessionId === undefined || sessionId.length === 0) {
		fail("Usage: sumeru stop <session_id>");
	}
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		await client.stopSession(sessionId);
		process.stdout.write(`stopped ${sessionId}\n`);
	} catch (err) {
		writeClientError(err);
	}
}

async function runImageList(
	flags: Map<string, string | boolean>,
): Promise<void> {
	const client = createHostClient({ baseUrl: resolveBaseUrl(flags) });
	try {
		const envelope = await client.listImages();
		process.stdout.write(`${formatImageTable(envelope.value)}\n`);
	} catch (err) {
		writeClientError(err);
	}
}

async function runImageBuild(
	flags: Map<string, string | boolean>,
	positionals: Array<string>,
): Promise<void> {
	const name = positionals[0];
	const agent = flagString(flags, "agent");
	const adapter = flagString(flags, "adapter");
	if (name === undefined || name.length === 0 || agent === null) {
		fail(
			"Usage: sumeru image build <name> --agent <type> [--adapter <pkg-or-path>]",
		);
	}
	const repoRoot = await findRepoRoot(process.cwd());
	try {
		const result = await executeImageBuild({
			name,
			agent,
			adapter,
			baseUrl: resolveBaseUrl(flags),
			repoRoot,
		});
		process.stdout.write(`built ${result.tag} (${result.digest})\n`);
		process.stdout.write(`registered image ${name}\n`);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		fail(msg);
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

	if (cmd === "setup") {
		const provider = flagString(parsed.flags, "provider");
		const apiKey = flagString(parsed.flags, "api-key");
		const model = flagString(parsed.flags, "model");
		if (provider === null || apiKey === null || model === null) {
			fail(
				"Usage: sumeru setup --provider <name> --api-key <key> --model <model-name>",
			);
		}
		try {
			await runSetup({
				provider,
				apiKey,
				model,
				apiType: flagString(parsed.flags, "api-type"),
				baseUrl: flagString(parsed.flags, "base-url"),
				rootDir: flagString(parsed.flags, "root-dir"),
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			fail(msg);
		}
		return;
	}

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

	if (cmd === "prototypes" || (cmd === "prototype" && sub === "list")) {
		await runPrototypes(parsed.flags);
		return;
	}
	if (cmd === "prototype") {
		if (sub === "add") {
			await runPrototypeAdd(parsed.flags, parsed.positionals);
			return;
		}
		if (sub === "remove") {
			await runPrototypeRemove(parsed.flags, parsed.positionals);
			return;
		}
		fail(`Unknown prototype subcommand: ${sub ?? "(none)"}`);
	}
	if (cmd === "provider") {
		if (sub === "list") {
			await runProviderList(parsed.flags);
			return;
		}
		if (sub === "add") {
			await runProviderAdd(parsed.flags, parsed.positionals);
			return;
		}
		if (sub === "remove") {
			await runProviderRemove(parsed.flags, parsed.positionals);
			return;
		}
		fail(`Unknown provider subcommand: ${sub ?? "(none)"}`);
	}
	if (cmd === "model") {
		if (sub === "list") {
			await runModelList(parsed.flags);
			return;
		}
		if (sub === "add") {
			await runModelAdd(parsed.flags, parsed.positionals);
			return;
		}
		if (sub === "remove") {
			await runModelRemove(parsed.flags, parsed.positionals);
			return;
		}
		fail(`Unknown model subcommand: ${sub ?? "(none)"}`);
	}
	if (cmd === "image") {
		if (sub === "list") {
			await runImageList(parsed.flags);
			return;
		}
		if (sub === "build") {
			await runImageBuild(parsed.flags, parsed.positionals);
			return;
		}
		fail(`Unknown image subcommand: ${sub ?? "(none)"}`);
	}
	if (cmd === "sessions") {
		await runSessions(parsed.flags);
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
	if (cmd === "stop") {
		await runStop(parsed.flags, parsed.positionals);
		return;
	}
	if (cmd === "images") {
		runImages();
		return;
	}

	fail(`Unknown command: ${cmd ?? "(none)"}. Run \`sumeru --help\`.`);
}

await main();
